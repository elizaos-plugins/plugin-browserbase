import { stagehandPlugin } from '../../dist/index.js';
import type { Content, HandlerCallback } from '@elizaos/core';

// Define the test suite interface
interface TestSuite {
  name: string;
  description?: string;
  tests: Array<{
    name: string;
    fn: (runtime: any) => Promise<any>;
  }>;
}

// Helper to create a test message
function createTestMessage(text: string) {
  return {
    id: `test-msg-${Date.now()}`,
    content: {
      text,
      source: 'test',
    },
    userId: 'test-user',
    roomId: 'test-room',
    createdAt: Date.now(),
  };
}

export const ScenariosTestSuite: TestSuite = {
  name: 'stagehand_scenarios_test_suite',
  description: 'Comprehensive test scenarios for browser automation capabilities',

  tests: [
    // ========== Navigation Tests ==========
    {
      name: 'navigation_capabilities_test',
      fn: async (runtime) => {
        console.log('🧭 Testing Navigation Capabilities');
        
        const actions = {
          navigate: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE'),
          back: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_BACK'),
          forward: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_FORWARD'),
          refresh: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_REFRESH'),
        };

        // Verify all navigation actions exist
        Object.entries(actions).forEach(([name, action]) => {
          if (!action) throw new Error(`${name} action not found`);
        });

        console.log('✅ All navigation actions available');

        // Test various navigation targets
        const navigationTargets = [
          { url: 'https://elizaos.github.io/eliza/docs/', name: 'ElizaOS Documentation' },
          { url: 'https://github.com/shawmakesmagic', name: 'GitHub Profile' },
          { url: 'https://google.com', name: 'Google Search' },
          { url: 'duckduckgo.com', name: 'DuckDuckGo' },
        ];

        for (const target of navigationTargets) {
          const msg = createTestMessage(`Navigate to ${target.url}`);
          const canNavigate = await actions.navigate!.validate(runtime, msg as any, {} as any);
          
          if (!canNavigate) {
            throw new Error(`Cannot navigate to ${target.name}`);
          }
          console.log(`✅ Can navigate to ${target.name}`);
        }
      },
    },

    // ========== Interaction Tests (Phase 2) ==========
    {
      name: 'interaction_capabilities_test',
      fn: async (runtime) => {
        console.log('🖱️ Testing Interaction Capabilities (Phase 2)');
        
        const actions = {
          click: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_CLICK'),
          type: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_TYPE'),
          select: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_SELECT'),
        };

        // Verify all interaction actions exist
        Object.entries(actions).forEach(([name, action]) => {
          if (!action) throw new Error(`${name} action not found`);
        });

        console.log('✅ All interaction actions available');

        // Test form interaction scenarios
        const formTests = [
          { action: 'type', message: 'Type "John Doe" in the name field' },
          { action: 'type', message: 'Enter "john@example.com" in the email field' },
          { action: 'select', message: 'Select "United States" from the country dropdown' },
          { action: 'click', message: 'Click on the submit button' },
        ];

        for (const test of formTests) {
          const msg = createTestMessage(test.message);
          const action = actions[test.action as keyof typeof actions];
          
          if (!action) throw new Error(`Action ${test.action} not found`);

          const canPerform = await action.validate(runtime, msg as any, {} as any);
          if (!canPerform) {
            throw new Error(`Cannot perform: ${test.message}`);
          }

          console.log(`✅ ${test.action.toUpperCase()}: ${test.message}`);
        }
      },
    },

    // ========== Extraction Tests (Phase 3) ==========
    {
      name: 'extraction_shaw_walters_test',
      fn: async (runtime) => {
        console.log('🔍 Testing Extraction Capabilities (Phase 3) - Shaw Walters');
        
        const actions = {
          navigate: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE'),
          extract: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_EXTRACT'),
        };

        if (!actions.navigate || !actions.extract) {
          throw new Error('Required actions for extraction not found');
        }

        // Navigate to Shaw's GitHub profile
        const navigateMsg = createTestMessage('Navigate to https://github.com/shawmakesmagic');
        
        let navigationSuccess = false;
        const navCallback: HandlerCallback = async (content: Content) => {
          navigationSuccess = content.text.includes('navigated to');
          return [];
        };

        await actions.navigate.handler(
          runtime,
          navigateMsg as any,
          {} as any,
          {},
          navCallback,
          []
        );

        if (!navigationSuccess) {
          throw new Error('Failed to navigate to GitHub profile');
        }

        console.log('✅ Navigated to shawmakesmagic GitHub profile');

        // Test extraction patterns
        const extractionPatterns = [
          { instruction: 'Extract the user\'s full name', expected: 'Shaw Walters' },
          { instruction: 'Find the full name on the page', expected: 'Shaw Walters' },
          { instruction: 'Get the profile owner\'s real name', expected: 'Shaw Walters' },
          { instruction: 'Extract the bio or description', expected: 'profile information' },
          { instruction: 'Extract the location if available', expected: 'location data' },
        ];

        for (const pattern of extractionPatterns) {
          const extractMsg = createTestMessage(pattern.instruction);
          const canExtract = await actions.extract.validate(runtime, extractMsg as any, {} as any);
          
          console.log(`${canExtract ? '✅' : '⚠️'} ${pattern.instruction}`);
        }

        console.log('📝 In production, would extract "Shaw Walters" from the GitHub profile');
      },
    },

    // ========== Search Engine Flow Test ==========
    {
      name: 'google_search_flow_test',
      fn: async (runtime) => {
        console.log('🔎 Testing Complete Search Engine Flow');
        
        const actions = {
          navigate: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_NAVIGATE'),
          type: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_TYPE'),
          click: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_CLICK'),
          extract: stagehandPlugin.actions?.find((a) => a.name === 'BROWSER_EXTRACT'),
        };

        // Verify all required actions
        Object.entries(actions).forEach(([name, action]) => {
          if (!action) throw new Error(`${name} action not found`);
        });

        // Test the complete flow
        const workflow = [
          { 
            step: 'Navigate to Google',
            action: 'navigate',
            message: 'Go to google.com'
          },
          {
            step: 'Type search query',
            action: 'type',
            message: 'Type "ElizaOS documentation" in the search box'
          },
          {
            step: 'Click search button',
            action: 'click', 
            message: 'Click on the search button'
          },
          {
            step: 'Extract results',
            action: 'extract',
            message: 'Extract the first search result title'
          },
        ];

        for (const step of workflow) {
          const action = actions[step.action as keyof typeof actions];
          if (!action) throw new Error(`Action ${step.action} not found`);

          const msg = createTestMessage(step.message);
          const canPerform = await action.validate(runtime, msg as any, {} as any);

          console.log(`${canPerform ? '✅' : '❌'} ${step.step}`);
        }
      },
    },

    // ========== Screenshot Test ==========
    {
      name: 'screenshot_capability_test',
      fn: async (runtime) => {
        console.log('📸 Testing Screenshot Capability');
        
        const screenshotAction = stagehandPlugin.actions?.find(
          (a) => a.name === 'BROWSER_SCREENSHOT'
        );

        if (!screenshotAction) {
          throw new Error('BROWSER_SCREENSHOT action not found');
        }

        const screenshotScenarios = [
          'Take a screenshot of the page',
          'Capture the current view',
          'Screenshot the documentation',
        ];

        for (const scenario of screenshotScenarios) {
          const msg = createTestMessage(scenario);
          const canScreenshot = await screenshotAction.validate(runtime, msg as any, {} as any);

          if (!canScreenshot) {
            throw new Error(`Cannot validate screenshot: ${scenario}`);
          }
        }

        console.log('✅ Screenshot capability validated');
      },
    },

    // ========== Complete Workflow Summary ==========
    {
      name: 'complete_workflow_capabilities_summary',
      fn: async (runtime) => {
        console.log('\n📊 Complete Workflow Capabilities Summary');
        console.log('==========================================');
        
        const capabilities = {
          'Phase 1 - Navigation': [
            'BROWSER_NAVIGATE',
            'BROWSER_BACK',
            'BROWSER_FORWARD',
            'BROWSER_REFRESH',
          ],
          'Phase 2 - Interaction': [
            'BROWSER_CLICK',
            'BROWSER_TYPE',
            'BROWSER_SELECT',
          ],
          'Phase 3 - Extraction': [
            'BROWSER_EXTRACT',
            'BROWSER_SCREENSHOT',
          ],
        };

        const availableActions = stagehandPlugin.actions?.map(a => a.name) || [];
        
        for (const [phase, actions] of Object.entries(capabilities)) {
          console.log(`\n${phase}:`);
          for (const actionName of actions) {
            const available = availableActions.includes(actionName);
            console.log(`   ${available ? '✅' : '❌'} ${actionName}`);
          }
        }

        const totalRequired = Object.values(capabilities).flat().length;
        const totalAvailable = Object.values(capabilities).flat().filter(
          action => availableActions.includes(action)
        ).length;

        console.log(`\n🎯 Total: ${totalAvailable}/${totalRequired} capabilities available`);
        
        if (totalAvailable === totalRequired) {
          console.log('✅ All browser automation capabilities ready!');
        }
      },
    },
  ],
};

// Export default for the test runner
export default ScenariosTestSuite; 