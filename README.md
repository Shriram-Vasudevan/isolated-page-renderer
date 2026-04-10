# state-render

**State-Synthesized UI Renderer** — Render any Next.js page or React component in complete isolation, without navigating through your app. The system automatically detects all dependencies (auth, API calls, route params, context providers) and generates realistic mock data to render a live preview.

## What It Does

Given a target page like `/dashboard/projects/[id]`, state-render will:

1. **Analyze** the page file using AST parsing to detect all dependencies
2. **Detect** required inputs: route params, query params, API calls, auth/session, React context, hooks
3. **Generate** realistic mock data for every dependency
4. **Intercept** `fetch`, `XMLHttpRequest`, auth, and routing at runtime
5. **Render** the page in isolation in a live preview environment with scenario switching

## Quick Start

```bash
# From your Next.js project directory:
npx state-render /dashboard/projects/[id]

# Opens http://localhost:3899 with your page rendered in isolation
```

## Installation

```bash
# Clone and build
git clone <repo-url>
cd isolated-page-renderer
npm install
npm run build

# Run against your project
node dist/cli/index.js /your/route --project /path/to/nextjs-project
```

## CLI Usage

```bash
# Render a route
state-render /dashboard/projects/[id]

# Render a specific component
state-render --component src/components/UserCard.tsx

# Specify a scenario
state-render /dashboard --scenario empty
state-render /dashboard --scenario error
state-render /dashboard --scenario loading

# Custom port
state-render /dashboard --port 4000

# Target a different project directory
state-render /dashboard --project ../my-nextjs-app

# Analysis only (no server)
state-render /dashboard/projects/[id] --analyze-only --verbose

# List available scenarios
state-render /dashboard --list-scenarios

# Generate a scenario template
state-render /dashboard --generate-scenario custom-state
```

### Options

| Option | Description | Default |
|---|---|---|
| `[route]` | Route pattern to render | — |
| `--component <path>` | Render a specific component file | — |
| `--scenario <name>` | Scenario: `happy`, `empty`, `error`, `loading`, or custom | `happy` |
| `--port <number>` | Preview server port | `3899` |
| `--project <path>` | Target project root | `.` |
| `--analyze-only` | Run analysis without starting the server | — |
| `--verbose` | Show detailed analysis output | — |
| `--list-scenarios` | List available scenarios for a route | — |
| `--generate-scenario <name>` | Generate a scenario template file | — |

## Scenarios

state-render supports multiple rendering scenarios per page:

| Scenario | Behavior |
|---|---|
| `happy` | Full data, authenticated user, all APIs return 200 |
| `empty` | Empty arrays, zero counts — tests empty states |
| `error` | All APIs return 500, auth fails |
| `loading` | API responses are delayed indefinitely — tests loading states |

### Custom Scenarios

Generate a template:
```bash
state-render /dashboard --generate-scenario custom-state
```

This creates `.scenarios/dashboard.custom-state.ts`:

```typescript
const scenario = {
  name: 'dashboard.custom-state',
  scenario: 'custom-state',
  mocks: {
    apiMocks: {
      'GET:/api/dashboard/stats': {
        status: 200,
        data: { totalUsers: 0, growth: '-5.2%' },
      },
    },
    auth: {
      isAuthenticated: true,
      user: { id: '1', name: 'Test User', email: 'test@example.com' },
    },
  },
};
export default scenario;
```

### Live Scenario Switching

The preview includes an interactive bar at the bottom of the page that lets you switch between scenarios without restarting the server. This uses WebSocket for instant reload.

## Architecture

```
src/
├── cli/
│   └── index.ts              # CLI entry point (commander)
├── core/
│   ├── analyzer/
│   │   ├── types.ts           # All analysis type definitions
│   │   ├── ast-analyzer.ts    # Babel AST parser - detects dependencies
│   │   ├── route-resolver.ts  # Resolves route patterns to files
│   │   └── index.ts
│   ├── mocker/
│   │   ├── types.ts           # Mock config types
│   │   ├── data-generators.ts # Realistic data generation
│   │   ├── rule-based-strategy.ts  # Default mock strategy
│   │   └── index.ts           # MockGenerator with pluggable strategies
│   ├── renderer/
│   │   ├── bundler.ts         # esbuild bundling + Next.js module mocks
│   │   ├── server.ts          # Express preview server + WebSocket
│   │   └── index.ts
│   ├── runtime/
│   │   ├── client-runtime.ts  # Browser-side fetch/XHR interceptor
│   │   ├── provider-wrapper.ts # React context provider generation
│   │   └── index.ts
│   └── scenarios/
│       └── index.ts           # Scenario file loading/generation
└── index.ts                   # Public API exports
```

### How It Works

#### 1. Dependency Analysis (`core/analyzer/`)

Uses **Babel AST parsing** to statically analyze the target file:

- **Imports**: Tracks all import statements to understand dependencies
- **API Calls**: Detects `fetch()`, `axios.*()`, `useSWR()`, `useQuery()` calls and extracts endpoint URLs
- **Auth**: Recognizes `useSession`, `useAuth`, `getServerSession`, etc. and tracks which properties are accessed
- **Route Params**: Extracted from file path patterns (`[id]`) and `useParams()` destructuring
- **Query Params**: Detected via `useSearchParams().get()` calls
- **Context**: Identifies `useContext`, `useTheme`, `useRouter`, etc.
- **Framework Detection**: Distinguishes Next.js App Router, Pages Router, and plain React

#### 2. Mock Generation (`core/mocker/`)

**Pluggable strategy system** with a rule-based default:

- Endpoint patterns are matched to domain generators (e.g., `/api/projects/` returns project-shaped data)
- Field names drive data type inference (`email` → email format, `createdAt` → ISO date, etc.)
- Scenarios modify the output: `empty` returns empty arrays, `error` returns 500s
- Auth mocks include realistic user data when the page uses auth hooks

Register custom strategies:
```typescript
import { MockGenerator, MockGeneratorStrategy } from 'state-render';

class LLMStrategy implements MockGeneratorStrategy {
  name = 'llm';
  async generate(context) {
    // Call your LLM to generate contextual mock data
  }
}

const generator = new MockGenerator();
generator.registerStrategy(new LLMStrategy());
generator.setActiveStrategy('llm');
```

#### 3. Runtime Interception (`core/runtime/`)

Injected as a `<script>` tag that runs before the component bundle:

- **`window.fetch`** is replaced with a mock-aware version that matches URLs against configured endpoints
- **`XMLHttpRequest`** is similarly wrapped (supports axios and other XHR-based libraries)
- **URL matching** supports exact matches and pattern matching with `{param}` placeholders
- Non-matched requests (static assets, etc.) pass through to the real network

#### 4. Bundling & Preview (`core/renderer/`)

- **esbuild** bundles the target component with all its dependencies into a single browser-ready ESM bundle
- Next.js modules (`next/navigation`, `next/router`, `next/image`, `next/link`, `next-auth/react`, `next/font`) are replaced with lightweight mocks
- CSS modules are handled (return class name proxies)
- `server-only` imports are stubbed out
- Path aliases from `tsconfig.json` (`@/` etc.) are resolved automatically
- Express serves the bundle + HTML shell, with a WebSocket for live scenario switching

## What Gets Mocked

| Dependency | How It's Mocked |
|---|---|
| `fetch()` calls | Intercepted, returns mock data based on URL pattern |
| `XMLHttpRequest` | Intercepted (supports axios) |
| `useSession()` / next-auth | Returns mock authenticated session |
| `useRouter()` | Returns mock router with logging push/replace/back |
| `useParams()` | Returns mock route params |
| `useSearchParams()` | Returns mock URLSearchParams |
| `usePathname()` | Returns constructed pathname |
| `next/image` | Renders as plain `<img>` |
| `next/link` | Renders as `<a>` with click logging |
| `next/font` | Returns system font fallback |
| CSS modules | Returns class name proxy |
| `server-only` | Stubbed out |

## Example

The `example/` directory contains a sample Next.js app with:

- `/dashboard` — Stats dashboard with API calls and auth
- `/dashboard/projects/[id]` — Project detail page with route params, tabs, API calls, and auth

Run the example:

```bash
# From the repo root
npm run build
node dist/cli/index.js '/dashboard/projects/[id]' --project ./example --verbose
# Open http://localhost:3899
```

## Framework Support

### Currently Supported
- Next.js App Router (client and server components)
- Next.js Pages Router
- React (plain)
- TypeScript and JavaScript

### Detected Patterns
- `fetch()` / `axios` / GraphQL clients
- React Query (`useQuery`, `useSuspenseQuery`, `useInfiniteQuery`)
- SWR (`useSWR`)
- next-auth (`useSession`, `getServerSession`)
- Next.js navigation hooks
- Custom React context providers

## Programmatic API

```typescript
import { analyzeFile, MockGenerator, startPreviewServer } from 'state-render';

// Analyze a file
const analysis = analyzeFile('/path/to/page.tsx');

// Generate mocks
const generator = new MockGenerator();
const mocks = await generator.generate(analysis, 'happy');

// Start preview
const { url, close } = await startPreviewServer({
  port: 3899,
  projectRoot: '/path/to/project',
  analysis,
  mocks,
  scenario: 'happy',
  mockGenerator: generator,
});
```

## Limitations

- Server components with `async` functions are detected but rendered as client components in the preview
- GraphQL query extraction is best-effort (detects the call, may not parse the full query)
- Some complex CSS-in-JS solutions may need additional esbuild plugins
- Dynamic imports (`import()`) inside components are not currently followed during analysis

## License

MIT
