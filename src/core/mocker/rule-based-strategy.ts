import { AnalysisResult, ApiCall } from '../analyzer/types';
import {
  MockGeneratorStrategy,
  MockGenerationContext,
  GeneratedMocks,
  MockResponse,
  MockAuth,
  Scenario,
} from './types';
import {
  generateUser,
  generateProject,
  generateTask,
  generateStats,
  generateNotification,
  generateArray,
  generateForFieldName,
} from './data-generators';

export class RuleBasedStrategy implements MockGeneratorStrategy {
  name = 'rule-based';

  async generate(context: MockGenerationContext): Promise<GeneratedMocks> {
    const { analysis, scenario } = context;

    // Use existing scenario overrides if provided
    if (context.existingScenario?.mocks) {
      return {
        apiMocks: context.existingScenario.mocks.apiMocks ?? this.generateApiMocks(analysis, scenario),
        auth: context.existingScenario.mocks.auth ?? this.generateAuth(analysis, scenario),
        routeParams: context.existingScenario.mocks.routeParams ?? this.generateRouteParams(analysis),
        queryParams: context.existingScenario.mocks.queryParams ?? this.generateQueryParams(analysis),
        providerProps: context.existingScenario.mocks.providerProps ?? {},
      };
    }

    return {
      apiMocks: this.generateApiMocks(analysis, scenario),
      auth: this.generateAuth(analysis, scenario),
      routeParams: this.generateRouteParams(analysis),
      queryParams: this.generateQueryParams(analysis),
      providerProps: {},
    };
  }

  private generateApiMocks(analysis: AnalysisResult, scenario: Scenario): Record<string, MockResponse> {
    const mocks: Record<string, MockResponse> = {};

    for (const apiCall of analysis.apiCalls) {
      const key = `${apiCall.method}:${apiCall.endpoint}`;
      mocks[key] = this.generateMockForEndpoint(apiCall, scenario);
    }

    return mocks;
  }

  private generateMockForEndpoint(apiCall: ApiCall, scenario: Scenario): MockResponse {
    if (scenario === 'error') {
      return {
        status: 500,
        data: { error: 'Internal Server Error', message: 'Something went wrong' },
      };
    }

    if (scenario === 'loading') {
      return {
        status: 200,
        data: null,
        delay: 999999, // effectively never resolves
      };
    }

    const endpoint = apiCall.endpoint.toLowerCase();
    const data = this.inferDataFromEndpoint(endpoint, scenario);

    return {
      status: 200,
      data,
    };
  }

  private inferDataFromEndpoint(endpoint: string, scenario: Scenario): unknown {
    const segments = endpoint.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] ?? '';
    const isDetailRoute = segments.some(s => s.startsWith('{') || s.startsWith('[') || /^\d+$/.test(s));

    // Try to match common API patterns
    if (this.matchesPattern(endpoint, ['user', 'users', 'profile', 'me', 'account'])) {
      if (isDetailRoute || endpoint.includes('/me')) {
        return generateUser();
      }
      return { data: generateArray(generateUser, undefined, scenario), total: 25, page: 1 };
    }

    if (this.matchesPattern(endpoint, ['project', 'projects'])) {
      if (isDetailRoute) {
        return generateProject();
      }
      return { data: generateArray(generateProject, undefined, scenario), total: 12, page: 1 };
    }

    if (this.matchesPattern(endpoint, ['task', 'tasks', 'todo', 'todos', 'issue', 'issues'])) {
      if (isDetailRoute) {
        return generateTask();
      }
      return { data: generateArray(generateTask, undefined, scenario), total: 48, page: 1 };
    }

    if (this.matchesPattern(endpoint, ['stats', 'analytics', 'dashboard', 'metrics', 'overview'])) {
      return generateStats();
    }

    if (this.matchesPattern(endpoint, ['notification', 'notifications', 'alert', 'alerts'])) {
      return { data: generateArray(generateNotification, undefined, scenario), unread: 3 };
    }

    // Fallback: generate a generic response based on the endpoint name
    if (isDetailRoute) {
      return this.generateGenericDetail(lastSegment);
    }
    return {
      data: generateArray(() => this.generateGenericDetail(lastSegment), undefined, scenario),
      total: 20,
      page: 1,
    };
  }

  private matchesPattern(endpoint: string, patterns: string[]): boolean {
    const lower = endpoint.toLowerCase();
    return patterns.some(p => lower.includes(p));
  }

  private generateGenericDetail(name: string): Record<string, unknown> {
    return {
      id: generateForFieldName('id'),
      name: generateForFieldName('name'),
      description: generateForFieldName('description'),
      status: generateForFieldName('status'),
      createdAt: generateForFieldName('createdAt'),
      updatedAt: generateForFieldName('updatedAt'),
    };
  }

  private generateAuth(analysis: AnalysisResult, scenario: Scenario): MockAuth {
    if (scenario === 'error') {
      return {
        isAuthenticated: false,
        user: null,
      };
    }

    // If the page uses auth, generate a mock authenticated user
    if (analysis.authDependencies.length > 0) {
      const user = generateUser();
      const sessionData: Record<string, unknown> = { user };

      // Include accessed properties
      for (const authDep of analysis.authDependencies) {
        for (const prop of authDep.accessedProperties) {
          if (!(prop in sessionData)) {
            sessionData[prop] = generateForFieldName(prop);
          }
        }
      }

      return {
        isAuthenticated: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        },
        token: 'mock-jwt-token-' + Math.random().toString(36).slice(2),
        session: sessionData,
      };
    }

    return {
      isAuthenticated: false,
      user: null,
    };
  }

  private generateRouteParams(analysis: AnalysisResult): Record<string, string> {
    const params: Record<string, string> = {};
    for (const param of analysis.routeParams) {
      if (param.inferredType === 'number') {
        params[param.name] = String(Math.floor(Math.random() * 1000) + 1);
      } else {
        params[param.name] = `mock-${param.name}-${Math.random().toString(36).slice(2, 8)}`;
      }
    }
    return params;
  }

  private generateQueryParams(analysis: AnalysisResult): Record<string, string> {
    const params: Record<string, string> = {};
    for (const param of analysis.queryParams) {
      switch (param.inferredType) {
        case 'number': params[param.name] = String(Math.floor(Math.random() * 100)); break;
        case 'boolean': params[param.name] = 'true'; break;
        default: params[param.name] = `mock-${param.name}`;
      }
    }
    return params;
  }
}
