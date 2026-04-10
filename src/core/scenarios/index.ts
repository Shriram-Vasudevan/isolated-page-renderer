import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import { Scenario, ScenarioFile } from '../mocker/types';

const SCENARIOS_DIR = '.scenarios';

/**
 * Load a scenario file for a given page route and scenario name.
 */
export async function loadScenario(
  projectRoot: string,
  routePattern: string,
  scenario: Scenario
): Promise<ScenarioFile | undefined> {
  const scenariosDir = path.join(projectRoot, SCENARIOS_DIR);
  if (!fs.existsSync(scenariosDir)) return undefined;

  // Convert route to scenario file name
  // /dashboard/projects/[id] -> dashboard.projects.[id].happy.ts
  const routeName = routePattern
    .replace(/^\//, '')
    .replace(/\//g, '.');

  const candidates = [
    `${routeName}.${scenario}.ts`,
    `${routeName}.${scenario}.js`,
    `${routeName}.${scenario}.json`,
  ];

  for (const candidate of candidates) {
    const filePath = path.join(scenariosDir, candidate);
    if (fs.existsSync(filePath)) {
      return loadScenarioFile(filePath, scenario);
    }
  }

  return undefined;
}

/**
 * List all available scenarios for a route.
 */
export async function listScenarios(
  projectRoot: string,
  routePattern: string
): Promise<string[]> {
  const scenariosDir = path.join(projectRoot, SCENARIOS_DIR);
  if (!fs.existsSync(scenariosDir)) return ['happy', 'empty', 'error', 'loading'];

  const routeName = routePattern
    .replace(/^\//, '')
    .replace(/\//g, '.');

  const pattern = `${routeName}.*.{ts,js,json}`;
  const files = await glob(pattern, { cwd: scenariosDir });

  const scenarios = files.map(f => {
    const parts = f.replace(/\.(ts|js|json)$/, '').split('.');
    return parts[parts.length - 1];
  });

  // Always include defaults
  const defaults = ['happy', 'empty', 'error', 'loading'];
  return [...new Set([...defaults, ...scenarios])];
}

/**
 * Generate a template scenario file for a route.
 */
export function generateScenarioTemplate(
  projectRoot: string,
  routePattern: string,
  scenario: Scenario
): string {
  const scenariosDir = path.join(projectRoot, SCENARIOS_DIR);
  fs.mkdirSync(scenariosDir, { recursive: true });

  const routeName = routePattern
    .replace(/^\//, '')
    .replace(/\//g, '.');

  const filePath = path.join(scenariosDir, `${routeName}.${scenario}.ts`);

  const template = `import { ScenarioFile } from 'state-render';

/**
 * Scenario: ${scenario}
 * Route: ${routePattern}
 *
 * Customize the mock data for this specific scenario.
 * Any values you provide here will override the auto-generated mocks.
 */
const scenario: ScenarioFile = {
  name: '${routeName}.${scenario}',
  scenario: '${scenario}',
  mocks: {
    // Override API responses
    apiMocks: {
      // 'GET:/api/example': {
      //   status: 200,
      //   data: { /* your mock data */ },
      // },
    },

    // Override auth state
    // auth: {
    //   isAuthenticated: true,
    //   user: {
    //     id: '1',
    //     name: 'Test User',
    //     email: 'test@example.com',
    //   },
    // },

    // Override route params
    // routeParams: {
    //   id: '123',
    // },

    // Override query params
    // queryParams: {},
  },
};

export default scenario;
`;

  fs.writeFileSync(filePath, template);
  return filePath;
}

async function loadScenarioFile(filePath: string, scenario: Scenario): Promise<ScenarioFile> {
  const ext = path.extname(filePath);

  if (ext === '.json') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    return {
      name: path.basename(filePath, ext),
      scenario,
      mocks: data,
    };
  }

  // For .ts/.js files, try to require them
  // In production, these would be compiled. For now, try direct require or dynamic import.
  try {
    // Try requiring directly (works for .js files)
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
    const module = require(resolved);
    return module.default || module;
  } catch {
    // If require fails, try reading as JSON-like structure
    const content = fs.readFileSync(filePath, 'utf-8');
    // Extract the object literal from the file
    const match = content.match(/mocks:\s*({[\s\S]*?})\s*[,}]/);
    if (match) {
      try {
        // This is best-effort parsing
        const mocksStr = match[1].replace(/\/\/.*$/gm, '').replace(/'/g, '"');
        const mocks = JSON.parse(mocksStr);
        return { name: path.basename(filePath, ext), scenario, mocks };
      } catch {
        // Fall through
      }
    }

    return {
      name: path.basename(filePath, ext),
      scenario,
      mocks: {},
    };
  }
}
