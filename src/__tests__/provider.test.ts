import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { stagehandPlugin, StagehandService, BrowserSession } from '../index';
import {
  createMockRuntime,
  createMockMemory,
  createMockState,
  setupLoggerSpies,
} from './test-utils';
import { Memory, State, logger } from '@elizaos/core';
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

describe('BROWSER_STATE provider', () => {
  let mockRuntime: any;
  let mockService: StagehandService;
  let mockSession: BrowserSession;
  let browserStateProvider: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock runtime and service
    mockRuntime = createMockRuntime();
    mockService = new StagehandService(mockRuntime);

    // Create a mock Stagehand instance
    const mockStagehand = new Stagehand({ env: 'LOCAL' } as any);
    mockSession = new BrowserSession('test-session-1', mockStagehand as any);

    // Mock service methods
    vi.spyOn(mockService, 'getCurrentSession').mockResolvedValue(mockSession);

    // Set up runtime to return our mock service
    mockRuntime.getService.mockReturnValue(mockService);

    // Get the provider
    browserStateProvider = stagehandPlugin.providers?.find((p) => p.name === 'BROWSER_STATE');
  });

  it('should exist in plugin providers', () => {
    expect(browserStateProvider).toBeDefined();
    expect(browserStateProvider.name).toBe('BROWSER_STATE');
    expect(browserStateProvider.description).toContain('browser state information');
  });

  describe('get method', () => {
    it('should return current session information when session exists', async () => {
      const mockMessage = createMockMemory();
      const mockState = createMockState();

      const result = await browserStateProvider.get(
        mockRuntime,
        mockMessage as Memory,
        mockState as State
      );

      expect(result.text).toBe('Current browser page: "Test Page Title" at https://example.com');
      expect(result.values).toEqual({
        hasSession: true,
        url: 'https://example.com',
        title: 'Test Page Title',
      });
      expect(result.data).toEqual({
        sessionId: 'test-session-1',
        createdAt: mockSession.createdAt,
      });
    });

    it('should return no session message when no session exists', async () => {
      mockService.getCurrentSession = vi.fn().mockResolvedValue(undefined);

      const mockMessage = createMockMemory();
      const mockState = createMockState();

      const result = await browserStateProvider.get(
        mockRuntime,
        mockMessage as Memory,
        mockState as State
      );

      expect(result.text).toBe('No active browser session');
      expect(result.values).toEqual({
        hasSession: false,
      });
      expect(result.data).toEqual({});
    });

    it('should handle errors gracefully when getting page info fails', async () => {
      // Make page.title throw an error
      mockSession.page.title = vi.fn().mockRejectedValue(new Error('Page error'));

      const mockMessage = createMockMemory();
      const mockState = createMockState();

      const result = await browserStateProvider.get(
        mockRuntime,
        mockMessage as Memory,
        mockState as State
      );

      expect(result.text).toBe('Error getting browser state');
      expect(result.values).toEqual({
        hasSession: true,
        error: true,
      });
      expect(result.data).toEqual({});
      expect(logger.error).toHaveBeenCalledWith('Error getting browser state:', expect.any(Error));
    });

    it('should work when service is not available', async () => {
      mockRuntime.getService.mockReturnValue(null);

      const mockMessage = createMockMemory();
      const mockState = createMockState();

      const result = await browserStateProvider.get(
        mockRuntime,
        mockMessage as Memory,
        mockState as State
      );

      expect(result.text).toBe('No active browser session');
      expect(result.values.hasSession).toBe(false);
    });

    it('should provide session creation time', async () => {
      const testDate = new Date('2024-01-01T00:00:00Z');
      mockSession.createdAt = testDate;

      const mockMessage = createMockMemory();
      const mockState = createMockState();

      const result = await browserStateProvider.get(
        mockRuntime,
        mockMessage as Memory,
        mockState as State
      );

      expect(result.data.createdAt).toEqual(testDate);
    });

    it('should handle URL without title', async () => {
      mockSession.page.title = vi.fn().mockResolvedValue('');

      const mockMessage = createMockMemory();
      const mockState = createMockState();

      const result = await browserStateProvider.get(
        mockRuntime,
        mockMessage as Memory,
        mockState as State
      );

      expect(result.text).toBe('Current browser page: "" at https://example.com');
      expect(result.values.title).toBe('');
    });
  });
});
