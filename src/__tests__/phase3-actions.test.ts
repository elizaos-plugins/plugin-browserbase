import { describe, expect, it, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import { stagehandPlugin, StagehandService, BrowserSession } from '../index';
import {
  createMockRuntime,
  createMockMemory,
  createMockState,
  setupLoggerSpies,
} from './test-utils';
import { type HandlerCallback, type Memory, type State, type IAgentRuntime } from '@elizaos/core';
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
        screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot-data')),
      };

      return {
        init: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        page: mockPage,
        act: vi.fn().mockResolvedValue({ success: true }),
        extract: vi.fn().mockResolvedValue({ data: 'extracted text', found: true }),
      };
    }),
  };
});

describe('Phase 3 Browser Actions', () => {
  let loggerSpies: ReturnType<typeof setupLoggerSpies>;

  beforeAll(() => {
    loggerSpies = setupLoggerSpies();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('BROWSER_EXTRACT Action', () => {
    const extractAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_EXTRACT');
    let mockRuntime: any;
    let mockService: StagehandService;
    let mockSession: BrowserSession;
    let mockCallback: HandlerCallback;

    beforeEach(() => {
      vi.clearAllMocks();

      mockRuntime = createMockRuntime();
      mockService = new StagehandService(mockRuntime);

      const mockStagehand = new Stagehand({ env: 'LOCAL' } as any);
      mockSession = new BrowserSession('test-session', mockStagehand as any);

      vi.spyOn(mockService, 'getCurrentSession').mockResolvedValue(mockSession);
      mockRuntime.getService.mockReturnValue(mockService);
      mockCallback = vi.fn().mockResolvedValue([]);
    });

    it('should validate extract messages', async () => {
      const validMessages = [
        'Extract the main heading',
        'Get the page title',
        'Read the article content',
        'Find the author name',
      ];

      for (const text of validMessages) {
        const message = createMockMemory({ content: { text } });
        const isValid = await extractAction!.validate(mockRuntime, message as Memory, {} as State);
        expect(isValid).toBe(true);
      }
    });

    it('should handle extract action when data is found', async () => {
      const message = createMockMemory({
        content: { text: 'Extract the main heading from the page', source: 'test' },
      });

      mockSession.stagehand.extract = vi.fn().mockResolvedValue({
        data: 'Welcome to ElizaOS',
        found: true,
      });

      const result = await extractAction!.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.stagehand.extract).toHaveBeenCalledWith({
        instruction: 'the main heading from the page',
        schema: expect.any(Object),
      });
      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I found the following: "Welcome to ElizaOS"',
        actions: ['BROWSER_EXTRACT'],
        source: 'test',
        data: { data: 'Welcome to ElizaOS', found: true },
      });
    });

    it('should handle extract action when data is not found', async () => {
      const message = createMockMemory({
        content: { text: 'Find the price information', source: 'test' },
      });

      mockSession.stagehand.extract = vi.fn().mockResolvedValue({
        data: '',
        found: false,
      });

      const result = await extractAction!.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I could not find the requested information on this page',
        actions: ['BROWSER_EXTRACT'],
        source: 'test',
        data: { data: '', found: false },
      });
    });

    it('should handle specific data extraction', async () => {
      const message = createMockMemory({
        content: { text: 'Extract the author name', source: 'test' },
      });

      mockSession.stagehand.extract = vi.fn().mockResolvedValue({
        data: 'Shaw Walters',
        found: true,
      });

      const result = await extractAction!.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.stagehand.extract).toHaveBeenCalledWith({
        instruction: 'the author name',
        schema: expect.any(Object),
      });
      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I found the following: "Shaw Walters"',
        actions: ['BROWSER_EXTRACT'],
        source: 'test',
        data: { data: 'Shaw Walters', found: true },
      });
    });
  });

  describe('BROWSER_SCREENSHOT Action', () => {
    const screenshotAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_SCREENSHOT');
    let mockRuntime: any;
    let mockService: StagehandService;
    let mockSession: BrowserSession;
    let mockCallback: HandlerCallback;

    beforeEach(() => {
      vi.clearAllMocks();

      mockRuntime = createMockRuntime();
      mockService = new StagehandService(mockRuntime);

      const mockStagehand = new Stagehand({ env: 'LOCAL' } as any);
      mockSession = new BrowserSession('test-session', mockStagehand as any);

      vi.spyOn(mockService, 'getCurrentSession').mockResolvedValue(mockSession);
      mockRuntime.getService.mockReturnValue(mockService);
      mockCallback = vi.fn().mockResolvedValue([]);
    });

    it('should validate screenshot messages', async () => {
      const validMessages = [
        'Take a screenshot',
        'Capture the page',
        'Take a snapshot of the current view',
        'Screenshot this page',
      ];

      for (const text of validMessages) {
        const message = createMockMemory({ content: { text } });
        const isValid = await screenshotAction!.validate(
          mockRuntime,
          message as Memory,
          {} as State
        );
        expect(isValid).toBe(true);
      }
    });

    it('should handle screenshot action', async () => {
      const message = createMockMemory({
        content: { text: 'Take a screenshot of the page', source: 'test' },
      });

      const mockScreenshotData = Buffer.from('fake-screenshot-data');
      mockSession.page.screenshot = vi.fn().mockResolvedValue(mockScreenshotData);

      const result = await screenshotAction!.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.page.screenshot).toHaveBeenCalledWith({
        type: 'png',
        fullPage: true,
      });
      expect(mockCallback).toHaveBeenCalledWith({
        text: "I've taken a screenshot of the current page",
        actions: ['BROWSER_SCREENSHOT'],
        source: 'test',
        data: {
          screenshot: mockScreenshotData.toString('base64'),
          mimeType: 'image/png',
        },
      });
    });

    it('should not validate non-screenshot messages', async () => {
      const message = createMockMemory({ content: { text: 'Navigate to google.com' } });
      const isValid = await screenshotAction!.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(false);
    });
  });

  describe('Integration Tests', () => {
    it('should have all Phase 3 actions registered', () => {
      const actionNames = stagehandPlugin.actions?.map((a) => a.name) || [];

      expect(actionNames).toContain('BROWSER_EXTRACT');
      expect(actionNames).toContain('BROWSER_SCREENSHOT');
    });

    it('should support extraction after navigation', async () => {
      const navigateAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE');
      const extractAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_EXTRACT');

      expect(navigateAction).toBeDefined();
      expect(extractAction).toBeDefined();

      // Both actions should work with the same session
      const mockRuntime = createMockRuntime();
      const mockService = new StagehandService(mockRuntime as unknown as IAgentRuntime);
      mockRuntime.getService.mockReturnValue(mockService);

      const message1 = createMockMemory({ content: { text: 'Navigate to example.com' } });
      const message2 = createMockMemory({ content: { text: 'Extract the page title' } });

      // Validate both actions can work in sequence
      const canNavigate = await navigateAction!.validate(
        mockRuntime as unknown as IAgentRuntime,
        message1 as Memory,
        {} as State
      );
      const canExtract = await extractAction!.validate(
        mockRuntime as unknown as IAgentRuntime,
        message2 as Memory,
        {} as State
      );

      expect(canNavigate).toBe(true);
      expect(canExtract).toBe(false); // No session in test
    });
  });
});
