export type Scenario = 'happy' | 'empty' | 'loading' | 'error' | string;

export interface MockConfig {
  scenario: Scenario;
  /** Overrides for specific API endpoints */
  apiOverrides: Record<string, MockResponse>;
  /** Auth/session mock */
  auth: MockAuth;
  /** Route params */
  routeParams: Record<string, string>;
  /** Query params */
  queryParams: Record<string, string>;
  /** Delay in ms for simulating loading */
  delay: number;
}

export interface MockResponse {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
  delay?: number;
}

export interface MockAuth {
  isAuthenticated: boolean;
  user: MockUser | null;
  token?: string;
  session?: Record<string, unknown>;
}

export interface MockUser {
  id: string;
  name: string;
  email: string;
  image?: string;
  role?: string;
  [key: string]: unknown;
}

export interface MockGeneratorStrategy {
  name: string;
  generate(context: MockGenerationContext): Promise<GeneratedMocks>;
}

export interface MockGenerationContext {
  analysis: import('../analyzer/types').AnalysisResult;
  scenario: Scenario;
  existingScenario?: ScenarioFile;
}

export interface GeneratedMocks {
  apiMocks: Record<string, MockResponse>;
  auth: MockAuth;
  routeParams: Record<string, string>;
  queryParams: Record<string, string>;
  providerProps: Record<string, unknown>;
}

export interface ScenarioFile {
  name: string;
  scenario: Scenario;
  mocks: Partial<GeneratedMocks>;
}
