import type { Plugin } from '@elizaos/core';
import {
  type Action,
  type Content,
  type GenerateTextParams,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type Provider,
  type ProviderResult,
  Service,
  type State,
  logger,
} from '@elizaos/core';
import { Stagehand } from '@browserbasehq/stagehand';
import { z } from 'zod';
import {
  BrowserServiceNotAvailableError,
  handleBrowserError,
  StagehandError,
  BrowserTimeoutError,
  BrowserNavigationError,
  BrowserSessionError,
  BrowserActionError,
  BrowserExtractionError,
  BrowserSecurityError,
} from './errors';
import { defaultUrlValidator, validateSecureAction, InputSanitizer } from './security';
import { retryWithBackoff, browserRetryConfigs } from './retry';

/**
 * Configuration schema for the browser automation plugin
 */
const configSchema = z.object({
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  BROWSER_HEADLESS: z
    .string()
    .transform((val) => val === 'true')
    .optional()
    .default('true'),
});

/**
 * Browser session management
 */
export class BrowserSession {
  constructor(
    public id: string,
    public stagehand: Stagehand,
    public createdAt: Date = new Date()
  ) {}

  get page() {
    return this.stagehand.page;
  }

  async destroy() {
    try {
      await this.stagehand.close();
    } catch (error) {
      logger.error('Error destroying browser session:', error);
    }
  }
}

/**
 * Stagehand service for browser automation
 */
export class StagehandService extends Service {
  static serviceType = 'stagehand';
  capabilityDescription = 'Browser automation service using Stagehand for web interactions';

  private sessions: Map<string, BrowserSession> = new Map();
  private currentSessionId: string | null = null;
  private maxSessions = 3;

  constructor(protected runtime: IAgentRuntime) {
    super(runtime);
  }

  static async start(runtime: IAgentRuntime) {
    logger.info('Starting Stagehand browser automation service');
    const service = new StagehandService(runtime);
    return service;
  }

  static async stop(runtime: IAgentRuntime) {
    logger.info('Stopping Stagehand browser automation service');
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    if (!service) {
      throw new Error('Stagehand service not found');
    }
    await service.stop();
  }

  async stop() {
    logger.info('Cleaning up browser sessions');
    for (const [sessionId, session] of this.sessions) {
      await session.destroy();
      this.sessions.delete(sessionId);
    }
  }

  async createSession(sessionId: string): Promise<BrowserSession> {
    // Check session limit
    if (this.sessions.size >= this.maxSessions) {
      // Remove oldest session
      const oldestSession = Array.from(this.sessions.entries()).sort(
        ([, a], [, b]) => a.createdAt.getTime() - b.createdAt.getTime()
      )[0];
      if (oldestSession) {
        await this.destroySession(oldestSession[0]);
      }
    }

    const env = process.env.BROWSERBASE_API_KEY ? 'BROWSERBASE' : 'LOCAL';
    const stagehand = new Stagehand({
      env,
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      headless: process.env.BROWSER_HEADLESS !== 'false',
      browserbaseSessionCreateParams:
        env === 'BROWSERBASE'
          ? {
              projectId: process.env.BROWSERBASE_PROJECT_ID!,
              browserSettings: {
                blockAds: true,
                viewport: {
                  width: 1280,
                  height: 720,
                },
              },
            }
          : undefined,
    });

    await stagehand.init();

    const session = new BrowserSession(sessionId, stagehand);
    this.sessions.set(sessionId, session);
    this.currentSessionId = sessionId;

    return session;
  }

  async getSession(sessionId: string): Promise<BrowserSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async getCurrentSession(): Promise<BrowserSession | undefined> {
    if (!this.currentSessionId) {
      return undefined;
    }
    return this.sessions.get(this.currentSessionId);
  }

  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.destroy();
      this.sessions.delete(sessionId);
      if (this.currentSessionId === sessionId) {
        this.currentSessionId = null;
      }
    }
  }
}

/**
 * Helper function to extract URL from text
 */
function extractUrl(text: string): string | null {
  // First try to find a URL in quotes
  const quotedUrlMatch = text.match(/["']([^"']+)["']/);
  if (quotedUrlMatch && (quotedUrlMatch[1].startsWith('http') || quotedUrlMatch[1].includes('.'))) {
    return quotedUrlMatch[1];
  }

  // Then try to find a URL pattern
  const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    return urlMatch[1];
  }

  // Try to find domain patterns
  const domainMatch = text.match(
    /(?:go to|navigate to|open|visit)\s+([a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,})/i
  );
  if (domainMatch) {
    return `https://${domainMatch[1]}`;
  }

  return null;
}

/**
 * Browser navigation action
 */
const browserNavigateAction: Action = {
  name: 'BROWSER_NAVIGATE',
  similes: ['GO_TO_URL', 'OPEN_WEBSITE', 'VISIT_PAGE', 'NAVIGATE_TO'],
  description: 'Navigate the browser to a specified URL',

  validate: async (_runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const url = extractUrl(message.content.text || '');
    return url !== null;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling BROWSER_NAVIGATE action');

      const service = runtime.getService(StagehandService.serviceType) as StagehandService;
      if (!service) {
        const error = new BrowserServiceNotAvailableError();
        handleBrowserError(error, callback, 'navigate to the requested page');
        return;
      }

      const url = extractUrl(message.content.text || '');
      if (!url) {
        const error = new StagehandError(
          'No URL found in message',
          'NO_URL_FOUND',
          'I couldn\'t find a URL in your request. Please provide a valid URL to navigate to.',
          false
        );
        handleBrowserError(error, callback, 'navigate to a page');
        return;
      }

      // Validate URL security
      try {
        validateSecureAction(url, defaultUrlValidator);
      } catch (error) {
        if (error instanceof BrowserSecurityError) {
          handleBrowserError(error, callback);
          return;
        }
        throw error;
      }

      // Get or create session
      let session = await service.getCurrentSession();
      if (!session) {
        const sessionId = `session-${Date.now()}`;
        session = await service.createSession(sessionId);
      }

      // Navigate to URL with retry logic
      await retryWithBackoff(
        async () => {
          await session.page.goto(url);
          await session.page.waitForLoadState('domcontentloaded');
        },
        browserRetryConfigs.navigation,
        `navigate to ${url}`
      );

      const title = await session.page.title();
      const responseContent: Content = {
        text: `I've navigated to ${url}. The page title is: "${title}"`,
        actions: ['BROWSER_NAVIGATE'],
        source: message.content.source,
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in BROWSER_NAVIGATE action:', error);
      
      if (error instanceof StagehandError) {
        handleBrowserError(error, callback);
      } else {
        const browserError = new BrowserNavigationError(
          extractUrl(message.content.text || '') || 'the requested page',
          error as Error
        );
        handleBrowserError(browserError, callback);
      }
    }
  },

  /* v8 ignore start */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Go to google.com',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve navigated to https://google.com. The page title is: "Google"',
          actions: ['BROWSER_NAVIGATE'],
        },
      },
    ],
    [
      {
        name: '{{user}}',
        content: {
          text: 'Navigate to https://github.com/elizaos/eliza',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve navigated to https://github.com/elizaos/eliza. The page title is: "GitHub - elizaos/eliza"',
          actions: ['BROWSER_NAVIGATE'],
        },
      },
    ],
  ],
  /* v8 ignore stop */
};

/**
 * Browser back action
 */
const browserBackAction: Action = {
  name: 'BROWSER_BACK',
  similes: ['GO_BACK', 'PREVIOUS_PAGE', 'BACK_BUTTON'],
  description: 'Navigate back in browser history',

  validate: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    const session = await service?.getCurrentSession();
    return session !== undefined;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling BROWSER_BACK action');

      const service = runtime.getService(StagehandService.serviceType) as StagehandService;
      if (!service) {
        const error = new BrowserServiceNotAvailableError();
        handleBrowserError(error, callback, 'go back to the previous page');
        return;
      }

      const session = await service.getCurrentSession();
      if (!session) {
        const error = new BrowserSessionError('No active browser session');
        handleBrowserError(error, callback, 'go back');
        return;
      }

      await session.page.goBack();
      await session.page.waitForLoadState('domcontentloaded');

      const title = await session.page.title();
      const url = session.page.url();

      const responseContent: Content = {
        text: `I've navigated back. Now on: "${title}" (${url})`,
        actions: ['BROWSER_BACK'],
        source: message.content.source,
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in BROWSER_BACK action:', error);
      const browserError = new BrowserActionError('go back', 'browser history', error as Error);
      handleBrowserError(browserError, callback);
    }
  },

  /* v8 ignore start */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Go back to the previous page',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve navigated back. Now on: "Previous Page" (https://example.com)',
          actions: ['BROWSER_BACK'],
        },
      },
    ],
  ],
  /* v8 ignore stop */
};

/**
 * Browser forward action
 */
const browserForwardAction: Action = {
  name: 'BROWSER_FORWARD',
  similes: ['GO_FORWARD', 'NEXT_PAGE', 'FORWARD_BUTTON'],
  description: 'Navigate forward in browser history',

  validate: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    const session = await service?.getCurrentSession();
    return session !== undefined;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling BROWSER_FORWARD action');

      const service = runtime.getService(StagehandService.serviceType) as StagehandService;
      const session = await service.getCurrentSession();

      if (!session) {
        throw new Error('No active browser session');
      }

      await session.page.goForward();
      await session.page.waitForLoadState('domcontentloaded');

      const title = await session.page.title();
      const url = session.page.url();

      const responseContent: Content = {
        text: `I've navigated forward. Now on: "${title}" (${url})`,
        actions: ['BROWSER_FORWARD'],
        source: message.content.source,
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in BROWSER_FORWARD action:', error);
      throw error;
    }
  },

  /* v8 ignore start */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Go forward',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve navigated forward. Now on: "Next Page" (https://example.com/next)',
          actions: ['BROWSER_FORWARD'],
        },
      },
    ],
  ],
  /* v8 ignore stop */
};

/**
 * Browser refresh action
 */
const browserRefreshAction: Action = {
  name: 'BROWSER_REFRESH',
  similes: ['RELOAD_PAGE', 'REFRESH_PAGE', 'RELOAD', 'REFRESH'],
  description: 'Refresh the current browser page',

  validate: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<boolean> => {
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    const session = await service?.getCurrentSession();
    return session !== undefined;
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling BROWSER_REFRESH action');

      const service = runtime.getService(StagehandService.serviceType) as StagehandService;
      const session = await service.getCurrentSession();

      if (!session) {
        throw new Error('No active browser session');
      }

      await session.page.reload();
      await session.page.waitForLoadState('domcontentloaded');

      const title = await session.page.title();
      const url = session.page.url();

      const responseContent: Content = {
        text: `I've refreshed the page. Still on: "${title}" (${url})`,
        actions: ['BROWSER_REFRESH'],
        source: message.content.source,
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in BROWSER_REFRESH action:', error);
      throw error;
    }
  },

  /* v8 ignore start */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Refresh the page',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve refreshed the page. Still on: "Example Page" (https://example.com)',
          actions: ['BROWSER_REFRESH'],
        },
      },
    ],
  ],
  /* v8 ignore stop */
};

/**
 * Browser click action
 */
const browserClickAction: Action = {
  name: 'BROWSER_CLICK',
  similes: ['CLICK_ELEMENT', 'CLICK_BUTTON', 'CLICK_LINK', 'CLICK_ON'],
  description: 'Click on an element in the browser using natural language description',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    const session = await service?.getCurrentSession();
    if (!session) return false;
    
    // Check if message contains click intent
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('click') || text.includes('tap') || text.includes('press');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling BROWSER_CLICK action');

      const service = runtime.getService(StagehandService.serviceType) as StagehandService;
      const session = await service.getCurrentSession();

      if (!session) {
        throw new Error('No active browser session');
      }

      // Extract what to click from the message
      const text = message.content.text || '';
      const elementDescription = text.replace(/^(click|tap|press)\s+(on\s+)?/i, '').trim();

      // Use Stagehand's AI-powered click
      await session.stagehand.act({
        action: `click on ${elementDescription}`,
      });

      const responseContent: Content = {
        text: `I've clicked on "${elementDescription}"`,
        actions: ['BROWSER_CLICK'],
        source: message.content.source,
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in BROWSER_CLICK action:', error);
      throw error;
    }
  },

  /* v8 ignore start */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Click on the search button',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve clicked on "the search button"',
          actions: ['BROWSER_CLICK'],
        },
      },
    ],
  ],
  /* v8 ignore stop */
};

/**
 * Browser type action
 */
const browserTypeAction: Action = {
  name: 'BROWSER_TYPE',
  similes: ['TYPE_TEXT', 'ENTER_TEXT', 'FILL_FIELD', 'INPUT_TEXT'],
  description: 'Type text into an input field or element',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    const session = await service?.getCurrentSession();
    if (!session) return false;
    
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('type') || text.includes('enter') || text.includes('fill') || text.includes('input');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling BROWSER_TYPE action');

      const service = runtime.getService(StagehandService.serviceType) as StagehandService;
      const session = await service.getCurrentSession();

      if (!session) {
        throw new Error('No active browser session');
      }

      // Parse the message to extract what to type and where
      const text = message.content.text || '';
      const match = text.match(/(?:type|enter|fill|input)\s+["']([^"']+)["']\s+(?:in|into|to)?\s+(.+)/i) ||
                    text.match(/(?:type|enter|fill|input)\s+(.+?)\s+(?:in|into|to)\s+(.+)/i);

      if (!match) {
        throw new Error('Could not parse type command. Use format: "type \'text\' in field"');
      }

      const [, textToType, fieldDescription] = match;

      // Use Stagehand's AI-powered type
      await session.stagehand.act({
        action: `type "${textToType}" into ${fieldDescription}`,
      });

      const responseContent: Content = {
        text: `I've typed "${textToType}" into ${fieldDescription}`,
        actions: ['BROWSER_TYPE'],
        source: message.content.source,
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in BROWSER_TYPE action:', error);
      throw error;
    }
  },

  /* v8 ignore start */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Type "ElizaOS" in the search box',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve typed "ElizaOS" into the search box',
          actions: ['BROWSER_TYPE'],
        },
      },
    ],
  ],
  /* v8 ignore stop */
};

/**
 * Browser select action
 */
const browserSelectAction: Action = {
  name: 'BROWSER_SELECT',
  similes: ['SELECT_OPTION', 'CHOOSE_FROM_DROPDOWN', 'PICK_OPTION'],
  description: 'Select an option from a dropdown or select element',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    const session = await service?.getCurrentSession();
    if (!session) return false;
    
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('select') || text.includes('choose') || text.includes('pick');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling BROWSER_SELECT action');

      const service = runtime.getService(StagehandService.serviceType) as StagehandService;
      const session = await service.getCurrentSession();

      if (!session) {
        throw new Error('No active browser session');
      }

      const text = message.content.text || '';
      const match = text.match(/(?:select|choose|pick)\s+["']([^"']+)["']\s+(?:from|in)?\s+(.+)/i) ||
                    text.match(/(?:select|choose|pick)\s+(.+?)\s+(?:from|in)\s+(.+)/i);

      if (!match) {
        throw new Error('Could not parse select command. Use format: "select \'option\' from dropdown"');
      }

      const [, optionToSelect, dropdownDescription] = match;

      // Use Stagehand's AI-powered select
      await session.stagehand.act({
        action: `select "${optionToSelect}" from ${dropdownDescription}`,
      });

      const responseContent: Content = {
        text: `I've selected "${optionToSelect}" from ${dropdownDescription}`,
        actions: ['BROWSER_SELECT'],
        source: message.content.source,
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in BROWSER_SELECT action:', error);
      throw error;
    }
  },

  /* v8 ignore start */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Select "United States" from the country dropdown',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve selected "United States" from the country dropdown',
          actions: ['BROWSER_SELECT'],
        },
      },
    ],
  ],
  /* v8 ignore stop */
};

/**
 * Browser extract action
 */
const browserExtractAction: Action = {
  name: 'BROWSER_EXTRACT',
  similes: ['GET_TEXT', 'EXTRACT_DATA', 'READ_CONTENT', 'SCRAPE_TEXT'],
  description: 'Extract text or data from the current page',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    const session = await service?.getCurrentSession();
    if (!session) return false;
    
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('extract') || text.includes('get') || text.includes('read') || text.includes('find');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling BROWSER_EXTRACT action');

      const service = runtime.getService(StagehandService.serviceType) as StagehandService;
      const session = await service.getCurrentSession();

      if (!session) {
        throw new Error('No active browser session');
      }

      const text = message.content.text || '';
      const instruction = text.replace(/^(extract|get|read|find)\s+/i, '').trim();

      // Use Stagehand's extract method
      const extractedData = await session.stagehand.extract({
        instruction,
        schema: z.object({
          data: z.string().describe('The extracted data'),
          found: z.boolean().describe('Whether the requested data was found'),
        }),
      });

      const responseContent: Content = {
        text: extractedData.found 
          ? `I found the following: "${extractedData.data}"`
          : 'I could not find the requested information on this page',
        actions: ['BROWSER_EXTRACT'],
        source: message.content.source,
        data: extractedData,
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in BROWSER_EXTRACT action:', error);
      throw error;
    }
  },

  /* v8 ignore start */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Extract the main heading from the page',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I found the following: "Welcome to ElizaOS"',
          actions: ['BROWSER_EXTRACT'],
        },
      },
    ],
  ],
  /* v8 ignore stop */
};

/**
 * Browser screenshot action
 */
const browserScreenshotAction: Action = {
  name: 'BROWSER_SCREENSHOT',
  similes: ['TAKE_SCREENSHOT', 'CAPTURE_PAGE', 'SCREENSHOT_PAGE'],
  description: 'Take a screenshot of the current page',

  validate: async (runtime: IAgentRuntime, message: Memory, _state: State): Promise<boolean> => {
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    const session = await service?.getCurrentSession();
    if (!session) return false;
    
    const text = message.content.text?.toLowerCase() || '';
    return text.includes('screenshot') || text.includes('capture') || text.includes('snapshot');
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state: State,
    _options: any,
    callback: HandlerCallback,
    _responses: Memory[]
  ) => {
    try {
      logger.info('Handling BROWSER_SCREENSHOT action');

      const service = runtime.getService(StagehandService.serviceType) as StagehandService;
      const session = await service.getCurrentSession();

      if (!session) {
        throw new Error('No active browser session');
      }

      // Take screenshot
      const screenshot = await session.page.screenshot({
        type: 'png',
        fullPage: true,
      });

      // Convert to base64
      const base64Screenshot = screenshot.toString('base64');

      const responseContent: Content = {
        text: 'I\'ve taken a screenshot of the current page',
        actions: ['BROWSER_SCREENSHOT'],
        source: message.content.source,
        data: {
          screenshot: base64Screenshot,
          mimeType: 'image/png',
        },
      };

      await callback(responseContent);
      return responseContent;
    } catch (error) {
      logger.error('Error in BROWSER_SCREENSHOT action:', error);
      throw error;
    }
  },

  /* v8 ignore start */
  examples: [
    [
      {
        name: '{{user}}',
        content: {
          text: 'Take a screenshot of the page',
        },
      },
      {
        name: '{{agent}}',
        content: {
          text: 'I\'ve taken a screenshot of the current page',
          actions: ['BROWSER_SCREENSHOT'],
        },
      },
    ],
  ],
  /* v8 ignore stop */
};

/**
 * Browser state provider
 */
const browserStateProvider: Provider = {
  name: 'BROWSER_STATE',
  description: 'Provides current browser state information',

  get: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<ProviderResult> => {
    const service = runtime.getService(StagehandService.serviceType) as StagehandService;
    const session = await service?.getCurrentSession();

    if (!session) {
      return {
        text: 'No active browser session',
        values: {
          hasSession: false,
        },
        data: {},
      };
    }

    try {
      const url = session.page.url();
      const title = await session.page.title();

      return {
        text: `Current browser page: "${title}" at ${url}`,
        values: {
          hasSession: true,
          url,
          title,
        },
        data: {
          sessionId: session.id,
          createdAt: session.createdAt,
        },
      };
    } catch (error) {
      logger.error('Error getting browser state:', error);
      return {
        text: 'Error getting browser state',
        values: {
          hasSession: true,
          error: true,
        },
        data: {},
      };
    }
  },
};

/**
 * Stagehand browser automation plugin for ElizaOS
 */
export const stagehandPlugin: Plugin = {
  name: 'plugin-stagehand',
  description:
    'Browser automation plugin using Stagehand - stagehand is goated for web interactions',
  config: {
    BROWSERBASE_API_KEY: process.env.BROWSERBASE_API_KEY,
    BROWSERBASE_PROJECT_ID: process.env.BROWSERBASE_PROJECT_ID,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    BROWSER_HEADLESS: process.env.BROWSER_HEADLESS,
  },
  async init(config: Record<string, string>) {
    logger.info('Initializing Stagehand browser automation plugin');
    try {
      const validatedConfig = await configSchema.parseAsync(config);

      // Set environment variables
      for (const [key, value] of Object.entries(validatedConfig)) {
        if (value !== undefined) {
          process.env[key] = String(value);
        }
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid plugin configuration: ${error.errors.map((e) => e.message).join(', ')}`
        );
      }
      /* v8 ignore next 2 */
      throw error;
    }
  },
  services: [StagehandService],
  actions: [browserNavigateAction, browserBackAction, browserForwardAction, browserRefreshAction, browserClickAction, browserTypeAction, browserSelectAction, browserExtractAction, browserScreenshotAction],
  providers: [browserStateProvider],
  events: {
    BROWSER_PAGE_LOADED: [
      async (payload: any) => {
        logger.debug('BROWSER_PAGE_LOADED event', payload);
      },
    ],
    BROWSER_ERROR: [
      async (payload: any) => {
        logger.error('BROWSER_ERROR event', payload);
      },
    ],
  },
};

export default stagehandPlugin;
