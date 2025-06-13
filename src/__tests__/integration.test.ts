import { describe, expect, it, vi, beforeEach, afterAll, beforeAll } from 'vitest';
import { stagehandPlugin, StagehandService, BrowserSession } from '../index';
import { createMockRuntime, setupLoggerSpies, MockRuntime, createMockMemory, createMockState } from './test-utils';
import { HandlerCallback, IAgentRuntime, Memory, State, UUID, logger } from '@elizaos/core';
import { Stagehand } from '@browserbasehq/stagehand';

/**
 * Integration tests demonstrate how multiple components of the plugin work together.
 * These tests verify that actions, providers, and services work correctly in combination.
 */

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

// Set up spies on logger
beforeAll(() => {
  setupLoggerSpies();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('Integration: Browser Navigation with StagehandService', () => {
  let mockRuntime: MockRuntime;
  let service: StagehandService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime = createMockRuntime();
    service = new StagehandService(mockRuntime as unknown as IAgentRuntime);
    mockRuntime.getService = vi.fn().mockReturnValue(service);
  });

  it('should navigate to URL and provide state through provider', async () => {
    // Find the navigate action and state provider
    const navigateAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE');
    const stateProvider = stagehandPlugin.providers?.find((p) => p.name === 'BROWSER_STATE');
    
    expect(navigateAction).toBeDefined();
    expect(stateProvider).toBeDefined();

    // Create a test message
    const mockMessage: Memory = createMockMemory({
      content: {
        text: 'Navigate to https://github.com',
        source: 'test',
      },
    }) as Memory;

    const mockState = createMockState() as State;
    const mockCallback = vi.fn().mockResolvedValue([]);

    // Execute the navigation action
    await navigateAction!.handler(
      mockRuntime as unknown as IAgentRuntime,
      mockMessage,
      mockState,
      {},
      mockCallback as HandlerCallback,
      []
    );

    // Verify navigation happened
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('navigated to https://github.com'),
        actions: ['BROWSER_NAVIGATE'],
      })
    );

    // Get browser state from provider
    const providerResult = await stateProvider!.get(
      mockRuntime as unknown as IAgentRuntime,
      mockMessage,
      mockState
    );

    // Verify provider returns correct state
    expect(providerResult.text).toContain('Current browser page');
    expect(providerResult.values.hasSession).toBe(true);
    expect(providerResult.values.url).toBe('https://example.com');
    expect(providerResult.values.title).toBe('Test Page Title');
  });

  it('should handle navigation sequence: navigate, back, forward', async () => {
    const navigateAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE');
    const backAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_BACK');
    const forwardAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_FORWARD');

    const mockCallback = vi.fn().mockResolvedValue([]);

    // Navigate to first page
    await navigateAction!.handler(
      mockRuntime as unknown as IAgentRuntime,
      createMockMemory({ content: { text: 'Go to example.com' } }) as Memory,
      {} as State,
      {},
      mockCallback,
      []
    );

    // Go back
    await backAction!.handler(
      mockRuntime as unknown as IAgentRuntime,
      createMockMemory({ content: { text: 'Go back' } }) as Memory,
      {} as State,
      {},
      mockCallback,
      []
    );

    // Go forward
    await forwardAction!.handler(
      mockRuntime as unknown as IAgentRuntime,
      createMockMemory({ content: { text: 'Go forward' } }) as Memory,
      {} as State,
      {},
      mockCallback,
      []
    );

    // Verify all actions were called correctly
    expect(mockCallback).toHaveBeenCalledTimes(3);
    
    // Get the mock session to verify page methods were called
    const session = await service.getCurrentSession();
    expect(session).toBeDefined();
    expect(session!.page.goto).toHaveBeenCalled();
    expect(session!.page.goBack).toHaveBeenCalled();
    expect(session!.page.goForward).toHaveBeenCalled();
  });
});

describe('Integration: Session Management', () => {
  let mockRuntime: MockRuntime;
  let service: StagehandService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime = createMockRuntime();
    service = new StagehandService(mockRuntime as unknown as IAgentRuntime);
    mockRuntime.getService = vi.fn().mockReturnValue(service);
  });

  it('should create session on first navigation and reuse it', async () => {
    const navigateAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE');
    const refreshAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_REFRESH');
    
    const mockCallback = vi.fn().mockResolvedValue([]);

    // First navigation - should create session
    await navigateAction!.handler(
      mockRuntime as unknown as IAgentRuntime,
      createMockMemory({ content: { text: 'Go to google.com' } }) as Memory,
      {} as State,
      {},
      mockCallback,
      []
    );

    const sessionAfterFirst = await service.getCurrentSession();
    expect(sessionAfterFirst).toBeDefined();
    const firstSessionId = sessionAfterFirst!.id;

    // Refresh - should use same session
    await refreshAction!.handler(
      mockRuntime as unknown as IAgentRuntime,
      createMockMemory({ content: { text: 'Refresh' } }) as Memory,
      {} as State,
      {},
      mockCallback,
      []
    );

    const sessionAfterRefresh = await service.getCurrentSession();
    expect(sessionAfterRefresh?.id).toBe(firstSessionId);
  });

  it('should handle provider when no session exists', async () => {
    const stateProvider = stagehandPlugin.providers?.find((p) => p.name === 'BROWSER_STATE');
    
    // Get state when no session exists
    const result = await stateProvider!.get(
      mockRuntime as unknown as IAgentRuntime,
      createMockMemory() as Memory,
      {} as State
    );

    expect(result.text).toBe('No active browser session');
    expect(result.values.hasSession).toBe(false);
  });
});

describe('Integration: Plugin initialization and service registration', () => {
  it('should initialize the plugin and register the service', async () => {
    const mockRuntime = createMockRuntime();
    const registerServiceSpy = vi.fn();
    mockRuntime.registerService = registerServiceSpy;

    // Initialize the plugin
    if (stagehandPlugin.init) {
      await stagehandPlugin.init(
        { 
          BROWSERBASE_API_KEY: 'test-key',
          BROWSER_HEADLESS: 'true'
        },
        mockRuntime as unknown as IAgentRuntime
      );

      // Verify environment variables were set
      expect(process.env.BROWSERBASE_API_KEY).toBe('test-key');
      expect(process.env.BROWSER_HEADLESS).toBe('true');
    }

    // Simulate service registration
    if (stagehandPlugin.services) {
      const ServiceClass = stagehandPlugin.services[0];
      const serviceInstance = await ServiceClass.start(
        mockRuntime as unknown as IAgentRuntime
      );

      // Register the Service class
      mockRuntime.registerService(ServiceClass);
      
      // Verify the service was registered
      expect(registerServiceSpy).toHaveBeenCalledWith(expect.any(Function));
    }
  });
});

describe('Integration: Error Handling', () => {
  let mockRuntime: MockRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRuntime = createMockRuntime();
  });

  it('should handle navigation errors gracefully', async () => {
    const service = new StagehandService(mockRuntime as unknown as IAgentRuntime);
    mockRuntime.getService = vi.fn().mockReturnValue(service);

    // Make page.goto throw an error
    const mockStagehand = new Stagehand({ env: 'LOCAL' } as any);
    const mockSession = new BrowserSession('error-session', mockStagehand as any);
    mockSession.page.goto = vi.fn().mockRejectedValue(new Error('Navigation failed'));
    
    vi.spyOn(service, 'createSession').mockResolvedValue(mockSession);

    const navigateAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE');
    const mockCallback = vi.fn().mockResolvedValue([]);

    // Execute the handler
    await navigateAction!.handler(
      mockRuntime as unknown as IAgentRuntime,
      createMockMemory({ content: { text: 'Go to bad-url.com' } }) as Memory,
      {} as State,
      {},
      mockCallback,
      []
    );

    // Check that callback was called with error response
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('couldn\'t navigate to the requested page'),
        error: expect.objectContaining({
          code: 'BROWSER_NAVIGATION_ERROR',
          message: expect.stringContaining('Navigation failed'),
          recoverable: true
        })
      })
    );

    expect(logger.error).toHaveBeenCalledWith('Error in BROWSER_NAVIGATE action:', expect.any(Error));
  });

  it('should validate actions before execution', async () => {
    // No service available
    mockRuntime.getService = vi.fn().mockReturnValue(null);

    const backAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_BACK');
    
    // Validation should fail
    const isValid = await backAction!.validate(
      mockRuntime as unknown as IAgentRuntime,
      createMockMemory() as Memory,
      {} as State
    );

    expect(isValid).toBe(false);
  });
});
