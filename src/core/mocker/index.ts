import { AnalysisResult } from '../analyzer/types';
import {
  MockConfig,
  MockGeneratorStrategy,
  MockGenerationContext,
  GeneratedMocks,
  Scenario,
  ScenarioFile,
} from './types';
import { RuleBasedStrategy } from './rule-based-strategy';

export class MockGenerator {
  private strategies: Map<string, MockGeneratorStrategy> = new Map();
  private activeStrategy: string;

  constructor() {
    const defaultStrategy = new RuleBasedStrategy();
    this.strategies.set(defaultStrategy.name, defaultStrategy);
    this.activeStrategy = defaultStrategy.name;
  }

  registerStrategy(strategy: MockGeneratorStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  setActiveStrategy(name: string): void {
    if (!this.strategies.has(name)) {
      throw new Error(`Unknown mock strategy: ${name}. Available: ${[...this.strategies.keys()].join(', ')}`);
    }
    this.activeStrategy = name;
  }

  async generate(
    analysis: AnalysisResult,
    scenario: Scenario = 'happy',
    existingScenario?: ScenarioFile
  ): Promise<GeneratedMocks> {
    const strategy = this.strategies.get(this.activeStrategy);
    if (!strategy) {
      throw new Error(`Strategy "${this.activeStrategy}" not found`);
    }

    const context: MockGenerationContext = {
      analysis,
      scenario,
      existingScenario,
    };

    return strategy.generate(context);
  }

  buildMockConfig(mocks: GeneratedMocks, scenario: Scenario): MockConfig {
    return {
      scenario,
      apiOverrides: mocks.apiMocks,
      auth: mocks.auth,
      routeParams: mocks.routeParams,
      queryParams: mocks.queryParams,
      delay: scenario === 'loading' ? 999999 : 0,
    };
  }
}

export * from './types';
export { RuleBasedStrategy } from './rule-based-strategy';
export * from './data-generators';
