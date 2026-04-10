export interface RouteParam {
  name: string;
  isDynamic: boolean;
  /** Inferred type from usage context */
  inferredType: 'string' | 'number' | 'unknown';
}

export interface QueryParam {
  name: string;
  inferredType: 'string' | 'number' | 'boolean' | 'unknown';
  isOptional: boolean;
}

export interface ApiCall {
  /** The URL or endpoint pattern */
  endpoint: string;
  /** HTTP method if detectable */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'unknown';
  /** Where this call was found */
  source: 'fetch' | 'axios' | 'graphql' | 'swr' | 'react-query' | 'server-action' | 'unknown';
  /** The variable name holding the response, if any */
  responseVariable?: string;
  /** Inferred response shape from TypeScript types or usage */
  inferredResponseShape?: Record<string, unknown>;
  /** GraphQL query string if applicable */
  graphqlQuery?: string;
  /** Line number in source */
  line: number;
}

export interface AuthDependency {
  type: 'session' | 'cookie' | 'header' | 'context' | 'hook';
  /** The hook or function call that retrieves auth */
  source: string;
  /** Properties accessed on the auth object */
  accessedProperties: string[];
  line: number;
}

export interface ContextDependency {
  /** The context or provider name */
  name: string;
  /** The hook used to consume it */
  hook: string;
  /** Properties accessed */
  accessedProperties: string[];
  line: number;
}

export interface HookUsage {
  name: string;
  /** Arguments passed to the hook */
  args: string[];
  line: number;
}

export interface ImportInfo {
  source: string;
  specifiers: Array<{
    local: string;
    imported: string;
    isDefault: boolean;
  }>;
  line: number;
}

export interface AnalysisResult {
  /** Path to the analyzed file */
  filePath: string;
  /** Detected framework */
  framework: 'nextjs-app' | 'nextjs-pages' | 'react' | 'unknown';
  /** Whether this is a server component */
  isServerComponent: boolean;
  /** All imports */
  imports: ImportInfo[];
  /** Route parameters (from file path and usage) */
  routeParams: RouteParam[];
  /** Query parameters */
  queryParams: QueryParam[];
  /** API calls detected */
  apiCalls: ApiCall[];
  /** Auth dependencies */
  authDependencies: AuthDependency[];
  /** Context/provider dependencies */
  contextDependencies: ContextDependency[];
  /** React hooks used */
  hooks: HookUsage[];
  /** Component props interface if detectable */
  componentProps: Record<string, string>;
  /** Data fetching pattern */
  dataFetchingPattern: 'ssr' | 'ssg' | 'isr' | 'client' | 'server-component' | 'none';
  /** Exported component name */
  exportedComponent?: string;
  /** Whether it uses 'use client' directive */
  isClientComponent: boolean;
  /** Raw source code */
  sourceCode: string;
}
