# Stagehand Browser Automation Plugin for ElizaOS

This plugin enables ElizaOS agents to browse websites, interact with web elements, and extract data using the Stagehand browser automation framework.

## Features

- **Browser Navigation**: Navigate to URLs, go back/forward, refresh pages
- **AI-Powered Interactions**: Click, type, and select elements using natural language
- **Data Extraction**: Extract structured data from web pages
- **Computer Use Integration**: Use OpenAI and Anthropic computer use models
- **Session Management**: Handle multiple browser sessions efficiently
- **State Tracking**: Monitor browser state and page information

## Installation

```bash
npm install @elizaos/plugin-browserbase
```

## Configuration

### Environment Variables

```bash
# Optional - for cloud browser
BROWSERBASE_API_KEY=your_api_key
BROWSERBASE_PROJECT_ID=your_project_id

# Optional - for Computer Use features
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key

# Browser settings
BROWSER_HEADLESS=true  # Run in headless mode (default: true)
```

## Usage

### Adding to Your Agent

```typescript
import { stagehandPlugin } from '@elizaos/plugin-browserbase';

const agent = {
  name: 'BrowserAgent',
  plugins: [stagehandPlugin],
  // ... other configuration
};
```

### Available Actions

#### BROWSER_NAVIGATE
Navigate to a specified URL.

**Examples:**
- "Go to google.com"
- "Navigate to https://github.com/elizaos/eliza"
- "Open the website example.com"

#### BROWSER_BACK
Go back to the previous page in browser history.

**Examples:**
- "Go back"
- "Previous page"
- "Navigate back"

#### BROWSER_FORWARD
Go forward in browser history.

**Examples:**
- "Go forward"
- "Next page"

#### BROWSER_REFRESH
Refresh the current page.

**Examples:**
- "Refresh the page"
- "Reload"

### Providers

#### BROWSER_STATE
Provides current browser state information including URL, title, and session details.

The provider automatically includes browser state in the agent's context when making decisions.

## Development

### Setup

```bash
# Install dependencies
bun install

# Install Playwright browsers
bunx playwright install

# Build the plugin
bun run build
```

### Testing

   ```bash
   # Run all tests
bun run test

# Run component tests with coverage
bun run test:component

# Run e2e tests
bun run test:e2e
```

### Project Structure

```
plugin-browserbase/
├── src/
│   └── index.ts          # Main plugin implementation
├── __tests__/
│   ├── service.test.ts   # Service tests
│   ├── actions.test.ts   # Action tests
│   ├── provider.test.ts  # Provider tests
│   └── integration.test.ts # Integration tests
├── e2e/
│   └── stagehand-plugin.test.ts # E2E tests
└── package.json
```

## API Reference

### StagehandService

The core service that manages browser sessions.

```typescript
class StagehandService extends Service {
  // Create a new browser session
  async createSession(sessionId: string): Promise<BrowserSession>
  
  // Get an existing session
  async getSession(sessionId: string): Promise<BrowserSession | undefined>
  
  // Get the current active session
  async getCurrentSession(): Promise<BrowserSession | undefined>
  
  // Destroy a session
  async destroySession(sessionId: string): Promise<void>
}
```

### BrowserSession

Represents an active browser session.

```typescript
class BrowserSession {
  id: string;
  stagehand: Stagehand;
  createdAt: Date;
  page: Page; // Playwright page object
}
```

## Roadmap

- [x] Phase 1: Basic browser navigation
- [ ] Phase 2: Click, type, and select actions
- [ ] Phase 3: Computer Use integration
- [ ] Phase 4: Data extraction with schemas
- [ ] Phase 5: WebSocket integration for real-time updates

## Contributing

Contributions are welcome! Please ensure:
- All tests pass
- Code coverage remains high (target: 100%)
- Follow the existing code style
- Add tests for new features

## License

UNLICENSED

## Credits

Built with [Stagehand](https://github.com/browserbase/stagehand) - the AI-first browser automation framework.

---

*Note: This plugin is under active development. Features and APIs may change.*
