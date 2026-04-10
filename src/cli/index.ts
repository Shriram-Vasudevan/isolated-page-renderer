#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { analyzeFile, resolveRoute, resolveComponent } from '../core/analyzer';
import { MockGenerator } from '../core/mocker';
import { Scenario } from '../core/mocker/types';
import { startPreviewServer } from '../core/renderer/server';
import { loadScenario, listScenarios, generateScenarioTemplate } from '../core/scenarios';

const program = new Command();

program
  .name('state-render')
  .description('Render any page or component in isolation with automatically mocked dependencies')
  .version('0.1.0');

program
  .argument('[route]', 'Route pattern to render (e.g. /dashboard/projects/[id])')
  .option('-c, --component <path>', 'Render a specific component file')
  .option('-s, --scenario <name>', 'Scenario to render (happy, empty, error, loading, or custom)', 'happy')
  .option('-p, --port <number>', 'Port for the preview server', '3899')
  .option('--project <path>', 'Path to the target project root', '.')
  .option('--list-scenarios', 'List available scenarios for the target route')
  .option('--generate-scenario <name>', 'Generate a scenario template file')
  .option('--analyze-only', 'Only run analysis, don\'t start the server')
  .option('--verbose', 'Enable verbose output')
  .action(async (route: string | undefined, options: {
    component?: string;
    scenario: string;
    port: string;
    project: string;
    listScenarios?: boolean;
    generateScenario?: string;
    analyzeOnly?: boolean;
    verbose?: boolean;
  }) => {
    const projectRoot = path.resolve(options.project);

    console.log('');
    console.log(chalk.bold.blue('  state-render') + chalk.gray(' v0.1.0'));
    console.log(chalk.gray('  State-Synthesized UI Renderer'));
    console.log('');

    // Validate inputs
    if (!route && !options.component) {
      console.error(chalk.red('  Error: Provide a route pattern or --component path'));
      console.log('');
      console.log(chalk.gray('  Examples:'));
      console.log(chalk.gray('    npx state-render /dashboard/projects/[id]'));
      console.log(chalk.gray('    npx state-render --component src/components/UserCard.tsx'));
      console.log('');
      process.exit(1);
    }

    // List scenarios
    if (options.listScenarios && route) {
      const scenarios = await listScenarios(projectRoot, route);
      console.log(chalk.blue('  Available scenarios for ' + route + ':'));
      for (const s of scenarios) {
        console.log(chalk.gray('    - ') + s);
      }
      return;
    }

    // Generate scenario template
    if (options.generateScenario && route) {
      const filePath = generateScenarioTemplate(projectRoot, route, options.generateScenario);
      console.log(chalk.green('  Generated scenario template: ') + filePath);
      return;
    }

    // Resolve the target file
    let targetFile: string | null = null;
    let routePattern = route || '';

    if (options.component) {
      targetFile = await resolveComponent(options.component, projectRoot);
      if (!targetFile) {
        console.error(chalk.red(`  Error: Component not found: ${options.component}`));
        process.exit(1);
      }
      console.log(chalk.blue('  Component: ') + path.relative(projectRoot, targetFile));
    } else if (route) {
      console.log(chalk.blue('  Resolving route: ') + route);
      const resolved = await resolveRoute(route, projectRoot);
      if (resolved) {
        targetFile = resolved.filePath;
        console.log(chalk.green('  Found: ') + path.relative(projectRoot, targetFile));
        console.log(chalk.gray('  Router: ') + resolved.routerType);
        if (resolved.layoutFiles.length > 0) {
          console.log(chalk.gray('  Layouts: ') + resolved.layoutFiles.map(f => path.relative(projectRoot, f)).join(', '));
        }
      } else {
        console.error(chalk.red(`  Error: Could not resolve route: ${route}`));
        console.log(chalk.gray('  Checked: app/, src/app/, pages/, src/pages/'));
        process.exit(1);
      }
    }

    if (!targetFile) {
      console.error(chalk.red('  Error: No target file resolved'));
      process.exit(1);
    }

    // Analyze the file
    console.log('');
    console.log(chalk.blue('  Analyzing dependencies...'));
    const analysis = analyzeFile(targetFile);

    if (options.verbose || options.analyzeOnly) {
      printAnalysis(analysis);
    }

    if (options.analyzeOnly) {
      return;
    }

    // Load scenario overrides
    const scenario = options.scenario as Scenario;
    const existingScenario = route
      ? await loadScenario(projectRoot, route, scenario)
      : undefined;

    // Generate mocks
    console.log(chalk.blue('  Generating mocks...') + chalk.gray(` [scenario: ${scenario}]`));
    const mockGenerator = new MockGenerator();
    const mocks = await mockGenerator.generate(analysis, scenario, existingScenario);

    if (options.verbose) {
      console.log(chalk.gray('  API mocks:'), Object.keys(mocks.apiMocks).length, 'endpoints');
      console.log(chalk.gray('  Auth:'), mocks.auth.isAuthenticated ? 'authenticated' : 'none');
      console.log(chalk.gray('  Route params:'), mocks.routeParams);
      console.log(chalk.gray('  Query params:'), mocks.queryParams);
    }

    // Start the server
    const port = parseInt(options.port, 10);
    console.log(chalk.blue('  Starting preview server...'));
    console.log('');

    const { url, close } = await startPreviewServer({
      port,
      projectRoot,
      analysis,
      mocks,
      scenario,
      mockGenerator,
    });

    console.log(chalk.green.bold(`  Preview ready at ${url}`));
    console.log('');
    console.log(chalk.gray('  Scenario: ') + scenario);
    console.log(chalk.gray('  Mocked endpoints: ') + Object.keys(mocks.apiMocks).length);
    if (mocks.auth.isAuthenticated) {
      console.log(chalk.gray('  Auth: ') + `${mocks.auth.user?.name} (${mocks.auth.user?.email})`);
    }
    if (Object.keys(mocks.routeParams).length > 0) {
      console.log(chalk.gray('  Route params: ') + JSON.stringify(mocks.routeParams));
    }
    console.log('');
    console.log(chalk.gray('  Use the scenario switcher in the browser to change scenarios'));
    console.log(chalk.gray('  Press Ctrl+C to stop'));
    console.log('');

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('');
      console.log(chalk.gray('  Shutting down...'));
      close();
      // Clean up .state-render directory
      const outputDir = path.join(projectRoot, '.state-render');
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
      process.exit(0);
    });
  });

function printAnalysis(analysis: import('../core/analyzer/types').AnalysisResult): void {
  console.log('');
  console.log(chalk.bold('  Analysis Results'));
  console.log(chalk.gray('  ─'.repeat(30)));
  console.log(chalk.gray('  Framework:       ') + analysis.framework);
  console.log(chalk.gray('  Server Component:') + (analysis.isServerComponent ? ' yes' : ' no'));
  console.log(chalk.gray('  Client Component:') + (analysis.isClientComponent ? ' yes' : ' no'));
  console.log(chalk.gray('  Data Fetching:   ') + analysis.dataFetchingPattern);
  console.log(chalk.gray('  Exported:        ') + (analysis.exportedComponent || 'unknown'));

  if (analysis.imports.length > 0) {
    console.log('');
    console.log(chalk.gray('  Imports: ') + analysis.imports.length);
    for (const imp of analysis.imports.slice(0, 10)) {
      const specs = imp.specifiers.map(s => s.isDefault ? s.local : `{ ${s.imported} }`).join(', ');
      console.log(chalk.gray(`    ${specs}`) + ` from '${imp.source}'`);
    }
    if (analysis.imports.length > 10) {
      console.log(chalk.gray(`    ... and ${analysis.imports.length - 10} more`));
    }
  }

  if (analysis.routeParams.length > 0) {
    console.log('');
    console.log(chalk.gray('  Route Params:'));
    for (const p of analysis.routeParams) {
      console.log(chalk.gray(`    [${p.name}]`) + ` (${p.inferredType})`);
    }
  }

  if (analysis.apiCalls.length > 0) {
    console.log('');
    console.log(chalk.gray('  API Calls:'));
    for (const call of analysis.apiCalls) {
      console.log(chalk.gray(`    ${call.method} ${call.endpoint}`) + ` (${call.source}, line ${call.line})`);
    }
  }

  if (analysis.authDependencies.length > 0) {
    console.log('');
    console.log(chalk.gray('  Auth Dependencies:'));
    for (const auth of analysis.authDependencies) {
      console.log(chalk.gray(`    ${auth.source}`) + ` (${auth.type}, line ${auth.line})`);
      if (auth.accessedProperties.length > 0) {
        console.log(chalk.gray(`      properties: ${auth.accessedProperties.join(', ')}`));
      }
    }
  }

  if (analysis.contextDependencies.length > 0) {
    console.log('');
    console.log(chalk.gray('  Context Dependencies:'));
    for (const ctx of analysis.contextDependencies) {
      console.log(chalk.gray(`    ${ctx.name}`) + ` via ${ctx.hook} (line ${ctx.line})`);
    }
  }

  if (analysis.hooks.length > 0) {
    console.log('');
    console.log(chalk.gray('  Hooks:'));
    for (const hook of analysis.hooks) {
      console.log(chalk.gray(`    ${hook.name}(${hook.args.join(', ')})`) + ` (line ${hook.line})`);
    }
  }

  console.log('');
}

program.parse();
