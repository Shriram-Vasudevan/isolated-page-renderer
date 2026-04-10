# isolated-page-renderer

Renders Next.js page or React component in complete isolation with generated mock data.

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
## License

MIT
