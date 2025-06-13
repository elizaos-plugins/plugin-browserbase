import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { stagehandPlugin, StagehandService, BrowserSession } from '../index';
import { createMockRuntime, createMockMemory, createMockState, setupLoggerSpies } from './test-utils';
import { HandlerCallback, Memory, State, UUID, logger } from '@elizaos/core';
import { Stagehand } from '@browserbasehq/stagehand';

// Mock the Stagehand module
vi.mock('@browserbasehq/stagehand', () => {
  return {
    Stagehand: vi.fn().mockImplementation(() => {
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        goBack: vi.fn().mockResolvedValue(undefined),
        goForward: vi.fn().mockResolvedValue(undefined),
        reload: vi.fn().mockResolvedValue(undefined),
        waitForLoadState: vi.fn().mockResolvedValue(undefined),
        title: vi.fn().mockResolvedValue('Test Page Title'),
        url: vi.fn().mockReturnValue('https://example.com'),
      };

      return {
        init: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        page: mockPage,
      };
    }),
  };
});

// Set up logger spies
beforeAll(() => {
  setupLoggerSpies();
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Helper to get action by name
const getAction = (name: string) => {
  return stagehandPlugin.actions?.find((a) => a.name === name);
};

describe('BROWSER_NAVIGATE action', () => {
  let mockRuntime: any;
  let mockService: StagehandService;
  let mockSession: BrowserSession;
  let navigateAction: any;
  let mockCallback: HandlerCallback;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock service and session
    mockRuntime = createMockRuntime();
    mockService = new StagehandService(mockRuntime);
    
    // Create a mock Stagehand instance
    const mockStagehand = new Stagehand({ env: 'LOCAL' } as any);
    mockSession = new BrowserSession('test-session', mockStagehand as any);

    // Mock service methods
    vi.spyOn(mockService, 'getCurrentSession').mockResolvedValue(mockSession);
    vi.spyOn(mockService, 'createSession').mockResolvedValue(mockSession);

    // Set up runtime to return our mock service
    mockRuntime.getService.mockReturnValue(mockService);

    // Get the navigate action
    navigateAction = getAction('BROWSER_NAVIGATE');

    // Create mock callback
    mockCallback = vi.fn().mockResolvedValue([]);
  });

  describe('validate', () => {
    it('should validate when URL is found in message', async () => {
      const message = createMockMemory({
        content: { text: 'Go to https://google.com' },
      });

      const isValid = await navigateAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(true);
    });

    it('should validate domain without protocol', async () => {
      const message = createMockMemory({
        content: { text: 'Navigate to google.com' },
      });

      const isValid = await navigateAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(true);
    });

    it('should validate URL in quotes', async () => {
      const message = createMockMemory({
        content: { text: 'Open "https://example.com"' },
      });

      const isValid = await navigateAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(true);
    });

    it('should not validate when no URL found', async () => {
      const message = createMockMemory({
        content: { text: 'Just some random text' },
      });

      const isValid = await navigateAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(false);
    });
  });

  describe('handler', () => {
    it('should navigate to URL and return success', async () => {
      const message = createMockMemory({
        content: { text: 'Go to https://google.com', source: 'test' },
      });

      const result = await navigateAction.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.page.goto).toHaveBeenCalledWith('https://google.com');
      expect(mockSession.page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded');
      expect(mockSession.page.title).toHaveBeenCalled();
      
      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I\'ve navigated to https://google.com. The page title is: "Test Page Title"',
        actions: ['BROWSER_NAVIGATE'],
        source: 'test',
      });

      expect(result.text).toContain('navigated to https://google.com');
    });

    it('should create session if none exists', async () => {
      mockService.getCurrentSession = vi.fn().mockResolvedValue(undefined);

      const message = createMockMemory({
        content: { text: 'Go to https://google.com' },
      });

      await navigateAction.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockService.createSession).toHaveBeenCalledWith(expect.stringMatching(/^session-\d+$/));
    });

    it('should handle domain without protocol', async () => {
      const message = createMockMemory({
        content: { text: 'Visit example.com' },
      });

      await navigateAction.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.page.goto).toHaveBeenCalledWith('https://example.com');
    });

    it('should handle error when service not available', async () => {
      mockRuntime.getService.mockReturnValue(null);

      const message = createMockMemory({
        content: { text: 'Go to https://google.com' },
      });

      await navigateAction.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      // Check that callback was called with error response
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('browser automation service is not currently available'),
          error: expect.objectContaining({
            code: 'SERVICE_NOT_AVAILABLE',
            recoverable: false
          })
        })
      );
    });

    it('should handle error when no URL found', async () => {
      const message = createMockMemory({
        content: { text: 'No URL here' },
      });

      await navigateAction.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      // Check that callback was called with error response
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('couldn\'t find a URL in your request'),
          error: expect.objectContaining({
            code: 'NO_URL_FOUND',
            recoverable: false
          })
        })
      );
    });
  });

  describe('examples', () => {
    it('should have valid examples', () => {
      expect(navigateAction.examples).toHaveLength(2);
      expect(navigateAction.examples[0][0].content.text).toContain('google.com');
      expect(navigateAction.examples[0][1].content.actions).toContain('BROWSER_NAVIGATE');
    });
  });
});

describe('BROWSER_BACK action', () => {
  let mockRuntime: any;
  let mockService: StagehandService;
  let mockSession: BrowserSession;
  let backAction: any;
  let mockCallback: HandlerCallback;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRuntime = createMockRuntime();
    mockService = new StagehandService(mockRuntime);
    
    const mockStagehand = new Stagehand({ env: 'LOCAL' } as any);
    mockSession = new BrowserSession('test-session', mockStagehand as any);

    vi.spyOn(mockService, 'getCurrentSession').mockResolvedValue(mockSession);
    mockRuntime.getService.mockReturnValue(mockService);

    backAction = getAction('BROWSER_BACK');
    mockCallback = vi.fn().mockResolvedValue([]);
  });

  describe('validate', () => {
    it('should validate when session exists', async () => {
      const message = createMockMemory();
      const isValid = await backAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(true);
    });

    it('should not validate when no session exists', async () => {
      mockService.getCurrentSession = vi.fn().mockResolvedValue(undefined);
      
      const message = createMockMemory();
      const isValid = await backAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(false);
    });

    it('should not validate when service not available', async () => {
      mockRuntime.getService.mockReturnValue(null);
      
      const message = createMockMemory();
      const isValid = await backAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(false);
    });
  });

  describe('handler', () => {
    it('should navigate back and return page info', async () => {
      const message = createMockMemory({
        content: { text: 'Go back', source: 'test' },
      });

      const result = await backAction.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.page.goBack).toHaveBeenCalled();
      expect(mockSession.page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded');
      expect(mockSession.page.title).toHaveBeenCalled();
      expect(mockSession.page.url).toHaveBeenCalled();

      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I\'ve navigated back. Now on: "Test Page Title" (https://example.com)',
        actions: ['BROWSER_BACK'],
        source: 'test',
      });
    });

    it('should handle error when no session', async () => {
      mockService.getCurrentSession = vi.fn().mockResolvedValue(undefined);

      const message = createMockMemory();

      await backAction.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      // Check that callback was called with error response
      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('having trouble with the browser session'),
          error: expect.objectContaining({
            code: 'BROWSER_SESSION_ERROR',
            recoverable: true
          })
        })
      );
    });
  });
});

describe('BROWSER_FORWARD action', () => {
  let mockRuntime: any;
  let mockService: StagehandService;
  let mockSession: BrowserSession;
  let forwardAction: any;
  let mockCallback: HandlerCallback;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRuntime = createMockRuntime();
    mockService = new StagehandService(mockRuntime);
    
    const mockStagehand = new Stagehand({ env: 'LOCAL' } as any);
    mockSession = new BrowserSession('test-session', mockStagehand as any);

    vi.spyOn(mockService, 'getCurrentSession').mockResolvedValue(mockSession);
    mockRuntime.getService.mockReturnValue(mockService);

    forwardAction = getAction('BROWSER_FORWARD');
    mockCallback = vi.fn().mockResolvedValue([]);
  });

  describe('validate', () => {
    it('should validate when session exists', async () => {
      const message = createMockMemory();
      const isValid = await forwardAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(true);
    });

    it('should not validate when no session exists', async () => {
      mockService.getCurrentSession = vi.fn().mockResolvedValue(undefined);
      
      const message = createMockMemory();
      const isValid = await forwardAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(false);
    });
  });

  describe('handler', () => {
    it('should navigate forward and return page info', async () => {
      const message = createMockMemory({
        content: { text: 'Go forward', source: 'test' },
      });

      const result = await forwardAction.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.page.goForward).toHaveBeenCalled();
      expect(mockSession.page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded');

      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I\'ve navigated forward. Now on: "Test Page Title" (https://example.com)',
        actions: ['BROWSER_FORWARD'],
        source: 'test',
      });
    });

    it('should throw error when no session', async () => {
      mockService.getCurrentSession = vi.fn().mockResolvedValue(undefined);

      const message = createMockMemory();

      await expect(
        forwardAction.handler(
          mockRuntime,
          message as Memory,
          {} as State,
          {},
          mockCallback,
          []
        )
      ).rejects.toThrow('No active browser session');
    });

    it('should handle and rethrow page errors', async () => {
      const testError = new Error('Page navigation failed');
      mockSession.page.goForward = vi.fn().mockRejectedValue(testError);

      const message = createMockMemory();

      await expect(
        forwardAction.handler(
          mockRuntime,
          message as Memory,
          {} as State,
          {},
          mockCallback,
          []
        )
      ).rejects.toThrow('Page navigation failed');

      expect(logger.error).toHaveBeenCalledWith('Error in BROWSER_FORWARD action:', testError);
    });
  });
});

describe('BROWSER_REFRESH action', () => {
  let mockRuntime: any;
  let mockService: StagehandService;
  let mockSession: BrowserSession;
  let refreshAction: any;
  let mockCallback: HandlerCallback;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRuntime = createMockRuntime();
    mockService = new StagehandService(mockRuntime);
    
    const mockStagehand = new Stagehand({ env: 'LOCAL' } as any);
    mockSession = new BrowserSession('test-session', mockStagehand as any);

    vi.spyOn(mockService, 'getCurrentSession').mockResolvedValue(mockSession);
    mockRuntime.getService.mockReturnValue(mockService);

    refreshAction = getAction('BROWSER_REFRESH');
    mockCallback = vi.fn().mockResolvedValue([]);
  });

  describe('validate', () => {
    it('should validate when session exists', async () => {
      const message = createMockMemory();
      const isValid = await refreshAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(true);
    });

    it('should not validate when no session exists', async () => {
      mockService.getCurrentSession = vi.fn().mockResolvedValue(undefined);
      
      const message = createMockMemory();
      const isValid = await refreshAction.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(false);
    });
  });

  describe('handler', () => {
    it('should refresh page and return page info', async () => {
      const message = createMockMemory({
        content: { text: 'Refresh the page', source: 'test' },
      });

      const result = await refreshAction.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.page.reload).toHaveBeenCalled();
      expect(mockSession.page.waitForLoadState).toHaveBeenCalledWith('domcontentloaded');

      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I\'ve refreshed the page. Still on: "Test Page Title" (https://example.com)',
        actions: ['BROWSER_REFRESH'],
        source: 'test',
      });
    });

    it('should throw error when no session', async () => {
      mockService.getCurrentSession = vi.fn().mockResolvedValue(undefined);

      const message = createMockMemory();

      await expect(
        refreshAction.handler(
          mockRuntime,
          message as Memory,
          {} as State,
          {},
          mockCallback,
          []
        )
      ).rejects.toThrow('No active browser session');
    });
  });
});

describe('Browser actions metadata', () => {
  it('should have correct action names and similes', () => {
    const navigateAction = getAction('BROWSER_NAVIGATE');
    expect(navigateAction?.similes).toContain('GO_TO_URL');
    expect(navigateAction?.similes).toContain('OPEN_WEBSITE');
    expect(navigateAction?.description).toContain('Navigate the browser');

    const backAction = getAction('BROWSER_BACK');
    expect(backAction?.similes).toContain('GO_BACK');
    expect(backAction?.similes).toContain('PREVIOUS_PAGE');

    const forwardAction = getAction('BROWSER_FORWARD');
    expect(forwardAction?.similes).toContain('GO_FORWARD');
    expect(forwardAction?.similes).toContain('NEXT_PAGE');

    const refreshAction = getAction('BROWSER_REFRESH');
    expect(refreshAction?.similes).toContain('RELOAD_PAGE');
    expect(refreshAction?.similes).toContain('REFRESH');
  });
}); 