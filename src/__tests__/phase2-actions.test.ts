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

describe('Phase 2 Browser Actions', () => {
  let loggerSpies: ReturnType<typeof setupLoggerSpies>;

  beforeAll(() => {
    loggerSpies = setupLoggerSpies();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  describe('BROWSER_CLICK Action', () => {
    const clickAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_CLICK');
    let mockRuntime: any;
    let mockService: StagehandService;
    let mockSession: BrowserSession;
    let loggerSpy: any;
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

      // Set up runtime to return our mock service
      mockRuntime.getService.mockReturnValue(mockService);

      // Create mock callback
      mockCallback = vi.fn().mockResolvedValue([]);
    });

    it('should validate click messages', async () => {
      const validMessages = [
        'Click on the search button',
        'Press the submit button',
        'Tap on the menu icon',
      ];

      for (const text of validMessages) {
        const message = createMockMemory({ content: { text } });
        const isValid = await clickAction!.validate(mockRuntime, message as Memory, {} as State);
        expect(isValid).toBe(true);
      }
    });

    it('should not validate non-click messages', async () => {
      const message = createMockMemory({ content: { text: 'Navigate to google.com' } });
      const isValid = await clickAction!.validate(mockRuntime, message as Memory, {} as State);
      expect(isValid).toBe(false);
    });

    it('should handle click action', async () => {
      const message = createMockMemory({
        content: { text: 'Click on the search button', source: 'test' },
      });

      const result = await clickAction!.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.stagehand.act).toHaveBeenCalledWith({
        action: 'click on the search button',
      });
      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I\'ve clicked on "the search button"',
        actions: ['BROWSER_CLICK'],
        source: 'test',
      });
    });
  });

  describe('BROWSER_TYPE Action', () => {
    const typeAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_TYPE');
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

    it('should validate type messages', async () => {
      const validMessages = [
        'Type "hello" in the search box',
        'Enter "test@example.com" in the email field',
        'Fill "John Doe" in the name input',
        'Input "password123" in the password field',
      ];

      for (const text of validMessages) {
        const message = createMockMemory({ content: { text } });
        const isValid = await typeAction!.validate(mockRuntime, message as Memory, {} as State);
        expect(isValid).toBe(true);
      }
    });

    it('should handle type action with quoted text', async () => {
      const message = createMockMemory({
        content: { text: 'Type "ElizaOS" in the search box', source: 'test' },
      });

      const result = await typeAction!.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.stagehand.act).toHaveBeenCalledWith({
        action: 'type "ElizaOS" into the search box',
      });
      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I\'ve typed "ElizaOS" into the search box',
        actions: ['BROWSER_TYPE'],
        source: 'test',
      });
    });
  });

  describe('BROWSER_SELECT Action', () => {
    const selectAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_SELECT');
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

    it('should validate select messages', async () => {
      const validMessages = [
        'Select "United States" from the country dropdown',
        'Choose "Premium" from the plan selector',
        'Pick "Blue" from the color options',
      ];

      for (const text of validMessages) {
        const message = createMockMemory({ content: { text } });
        const isValid = await selectAction!.validate(mockRuntime, message as Memory, {} as State);
        expect(isValid).toBe(true);
      }
    });

    it('should handle select action', async () => {
      const message = createMockMemory({
        content: { text: 'Select "United States" from the country dropdown', source: 'test' },
      });

      const result = await selectAction!.handler(
        mockRuntime,
        message as Memory,
        {} as State,
        {},
        mockCallback,
        []
      );

      expect(mockSession.stagehand.act).toHaveBeenCalledWith({
        action: 'select "United States" from the country dropdown',
      });
      expect(mockCallback).toHaveBeenCalledWith({
        text: 'I\'ve selected "United States" from the country dropdown',
        actions: ['BROWSER_SELECT'],
        source: 'test',
      });
    });
  });
});
