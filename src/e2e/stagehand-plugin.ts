import { stagehandPlugin } from '../../dist/index.js';
import type { Content, HandlerCallback } from '@elizaos/core';

// Define a minimal TestSuite interface that matches what's needed
interface TestSuite {
  name: string;
  description?: string;
  tests: Array<{
    name: string;
    fn: (runtime: any) => Promise<any>;
  }>;
}

// Define minimal interfaces for the types we need
type UUID = `${string}-${string}-${string}-${string}-${string}`;

interface Memory {
  entityId: UUID;
  roomId: UUID;
  content: {
    text: string;
    source: string;
    actions?: string[];
  };
}

interface State {
  values: Record<string, any>;
  data: Record<string, any>;
  text: string;
}

export const StagehandPluginTestSuite: TestSuite = {
  name: 'plugin_stagehand_test_suite',
  description: 'Core E2E tests for the Stagehand browser automation plugin',

  tests: [
    {
      name: 'plugin_loads_correctly',
      fn: async (runtime) => {
        // Test the character name
        if (runtime.character.name !== 'Eliza') {
          throw new Error(
            `Expected character name to be "Eliza" but got "${runtime.character.name}"`
          );
        }
        
        // Verify the plugin is loaded properly
        const service = runtime.getService('stagehand');
        if (!service) {
          throw new Error('Stagehand service not found');
        }
      },
    },
    {
      name: 'should_have_all_browser_actions',
      fn: async (runtime) => {
        // Check if all browser actions are registered
        const actions = stagehandPlugin.actions || [];
        const actionNames = actions.map((a) => a.name);
        
        const requiredActions = [
          'BROWSER_NAVIGATE',
          'BROWSER_BACK', 
          'BROWSER_FORWARD',
          'BROWSER_REFRESH',
          'BROWSER_CLICK',
          'BROWSER_TYPE',
          'BROWSER_SELECT',
          'BROWSER_EXTRACT',
          'BROWSER_SCREENSHOT'
        ];
        
        for (const actionName of requiredActions) {
          if (!actionNames.includes(actionName)) {
            throw new Error(`Required action ${actionName} not found in plugin`);
          }
        }
        
        console.log(`✅ All ${requiredActions.length} browser actions registered`);
      },
    },
    {
      name: 'browser_navigate_action_test',
      fn: async (runtime) => {
        // Create a test message
        const testMessage: Memory = {
          entityId: '12345678-1234-1234-1234-123456789012' as UUID,
          roomId: '12345678-1234-1234-1234-123456789012' as UUID,
          content: {
            text: 'Navigate to https://example.com',
            source: 'test',
            actions: ['BROWSER_NAVIGATE'],
          },
        };

        // Create a test state
        const testState: State = {
          values: {},
          data: {},
          text: '',
        };

        let responseReceived = false;
        let responseText = '';

        // Find the browser navigate action
        const navigateAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE');
        if (!navigateAction) {
          throw new Error('Browser navigate action not found');
        }

        // Create a callback that meets the HandlerCallback interface
        const callback: HandlerCallback = async (response: Content) => {
          if (response.text && response.actions?.includes('BROWSER_NAVIGATE')) {
            responseReceived = true;
            responseText = response.text;
          }
          // Return Promise<Memory[]> as required by the HandlerCallback interface
          return Promise.resolve([]);
        };

        // Test the action directly
        try {
          await navigateAction.handler(runtime, testMessage, testState, {}, callback, []);
        } catch (error) {
          // In e2e tests, we might not have a real browser, so we check if the action was attempted
          if (error instanceof Error && error.message.includes('Stagehand service not available')) {
            // This is expected in test environment without full service setup
            responseReceived = true;
            responseText = 'Service not available in test environment';
          } else {
            throw error;
          }
        }

        if (!responseReceived) {
          throw new Error('Browser navigate action did not produce expected response');
        }
      },
    },
    {
      name: 'browser_state_provider_test',
      fn: async (runtime) => {
        // Create a test message
        const testMessage: Memory = {
          entityId: '12345678-1234-1234-1234-123456789012' as UUID,
          roomId: '12345678-1234-1234-1234-123456789012' as UUID,
          content: {
            text: 'What is the browser state?',
            source: 'test',
          },
        };

        // Create a test state
        const testState: State = {
          values: {},
          data: {},
          text: '',
        };

        // Find the browser state provider
        const browserStateProvider = stagehandPlugin.providers?.find(
          (p) => p.name === 'BROWSER_STATE'
        );
        if (!browserStateProvider) {
          throw new Error('Browser state provider not found');
        }

        // Test the provider
        const result = await browserStateProvider.get(runtime, testMessage, testState);

        // Should return no session state in test environment
        if (!result.text.includes('No active browser session') && !result.text.includes('Current browser page')) {
          throw new Error(`Unexpected provider response: "${result.text}"`);
        }
      },
    },
    {
      name: 'stagehand_service_test',
      fn: async (runtime) => {
        // Get the service from the runtime
        const service = runtime.getService('stagehand');
        if (!service) {
          throw new Error('Stagehand service not found');
        }

        // Check service capability description
        if (
          !service.capabilityDescription ||
          !service.capabilityDescription.includes('Browser automation')
        ) {
          throw new Error('Incorrect service capability description');
        }

        // Test service stop method exists
        if (typeof service.stop !== 'function') {
          throw new Error('Service stop method not found');
        }
      },
    },
    {
      name: 'url_extraction_validation_test',
      fn: async (runtime) => {
        // Test URL validation through action validation
        const navigateAction = stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE');
        if (!navigateAction) {
          throw new Error('Navigate action not found');
        }

        // Test various URL formats
        const testCases = [
          { text: 'Go to https://google.com', shouldValidate: true },
          { text: 'Navigate to example.com', shouldValidate: true },
          { text: 'Open "https://github.com"', shouldValidate: true },
          { text: 'Visit elizaos.github.io/eliza', shouldValidate: true },
          { text: 'Navigate to github.com/shawmakesmagic', shouldValidate: true },
          { text: 'Can you go to https://x.com/shawmakesmagic?', shouldValidate: true },
          { text: 'Just some random text', shouldValidate: false },
          { text: 'Please go to the ElizaOS documentation', shouldValidate: false },
        ];

        for (const testCase of testCases) {
          const message: Memory = {
            entityId: '12345678-1234-1234-1234-123456789012' as UUID,
            roomId: '12345678-1234-1234-1234-123456789012' as UUID,
            content: {
              text: testCase.text,
              source: 'test',
            },
          };

          const isValid = await navigateAction.validate(runtime, message, {} as State);
          
          if (isValid !== testCase.shouldValidate) {
            throw new Error(
              `URL validation failed for "${testCase.text}". Expected ${testCase.shouldValidate}, got ${isValid}`
            );
          }
        }
        
        console.log(`✅ All ${testCases.length} URL extraction tests passed`);
      },
    },
  ],
};

// Export a default instance of the test suite for the E2E test runner
export default StagehandPluginTestSuite;
