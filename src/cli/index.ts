#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import * as fs from 'fs';
import { analyzeFile, resolveInput, resolveComponent } from '../core/analyzer';
import { MockGenerator } from '../core/mocker';
import { Scenario } from '../core/mocker/types';
import { startPreviewServer } from '../core/renderer/server';
import { loadScenario, listScenarios, generateScenarioTemplate } from '../core/scenarios';

const program = new Command();

program
  .name('sr')
  .description('Render any page or component in isolation with automatically mocked dependencies')
  .version('0.1.0');

program
  .argument('[target]', 'Route, file path, or component to render. Accepts:\n' +
    '  Route:     /dashboard/projects/[id]\n' +
    '  File:      src/app/dashboard/page.tsx\n' +
    '  Absolute:  /Users/you/proj/src/app/page.tsx  (drag & drop)')
  .option('-s, --scenario <name>', 'Scenario to render (happy, empty, error, loading, or custom)', 'happy')
  .option('-p, --port <number>', 'Port for the preview server', '3899')
  .option('--project <path>', 'Path to the target project root (auto-detected from file path)')
  .option('--list-scenarios', 'List available scenarios for the target route')
  .option('--generate-scenario <name>', 'Generate a scenario template file')
  .option('--analyze-only', 'Only run analysis, don\'t start the server')
  .option('--verbose', 'Enable verbose output')
  .action(async (target: string | undefined, options: {
    scenario: string;
    port: string;
    project?: string;
    listScenarios?: boolean;
    generateScenario?: string;
    analyzeOnly?: boolean;
    verbose?: boolean;
  }) => {
    console.log('');
    console.log(chalk.bold('  sr') + chalk.gray(' v0.1.0'));
    console.log('');

    // Validate inputs
    if (!target) {
      console.error(chalk.red('  Error: Provide a route pattern or file path'));
      console.log('');
      console.log(chalk.gray('  Examples:'));
      console.log(chalk.gray('    sr /dashboard/projects/[id]              ') + chalk.gray('# route pattern'));
      console.log(chalk.gray('    sr src/app/dashboard/page.tsx            ') + chalk.gray('# relative file'));
      console.log(chalk.gray('    sr /abs/path/to/app/page.tsx             ') + chalk.gray('# absolute (drag & drop)'));
      console.log(chalk.gray('    sr src/components/Card.tsx               ') + chalk.gray('# any component'));
      console.log(chalk.gray('    sr /dashboard --scenario error           ') + chalk.gray('# with scenario'));
      console.log('');
      process.exit(1);
    }

    // Smart resolve: detects whether input is a file path or route pattern,
    // finds the project root automatically, extracts route params from the path.
    const resolved = await resolveInput(target, options.project);

    if (!resolved) {
      console.error(chalk.red(`  Error: Could not resolve "${target}"`));
      console.log('');
      console.log(chalk.gray('  Tried as:'));
      console.log(chalk.gray('    - File path (with .tsx/.ts/.jsx/.js extensions)'));
      console.log(chalk.gray('    - Route pattern (checked app/, src/app/, pages/, src/pages/)'));
      if (options.project) {
        console.log(chalk.gray('    - In project: ') + path.resolve(options.project));
      } else {
        console.log(chalk.gray('    - In: ') + process.cwd());
        console.log('');
        console.log(chalk.gray('  Tip: use --project <path> if running from outside the target project'));
      }
      console.log('');
      process.exit(1);
    }

    const { filePath, projectRoot, routePattern, routerType, mode } = resolved;

    console.log(chalk.gray('  ' + (mode === 'file' ? 'File:' : 'Route:') + '    ') + (mode === 'file' ? path.relative(process.cwd(), filePath) : routePattern));
    console.log(chalk.gray('  Project: ') + projectRoot);
    if (routerType !== 'component') {
      console.log(chalk.gray('  Router:  ') + routerType);
    }
    if (resolved.layoutFiles.length > 0) {
      console.log(chalk.gray('  Layouts: ') + resolved.layoutFiles.map(f => path.relative(projectRoot, f)).join(', '));
    }

    // List scenarios
    if (options.listScenarios) {
      const scenarios = await listScenarios(projectRoot, routePattern);
      console.log('');
      console.log(chalk.gray('  Scenarios:'));
      for (const s of scenarios) {
        console.log(chalk.gray('    - ') + s);
      }
      return;
    }

    // Generate scenario template
    if (options.generateScenario) {
      const scenarioPath = generateScenarioTemplate(projectRoot, routePattern, options.generateScenario);
      console.log('');
      console.log(chalk.green('  Generated: ') + scenarioPath);
      return;
    }

    // Analyze
    console.log('');
    console.log(chalk.gray('  Analyzing...'));
    const analysis = analyzeFile(filePath, resolved.routeParams);

    if (options.verbose || options.analyzeOnly) {
      printAnalysis(analysis);
    }

    if (options.analyzeOnly) {
      return;
    }

    // Load scenario overrides
    const scenario = options.scenario as Scenario;
    const existingScenario = await loadScenario(projectRoot, routePattern, scenario);

    // Generate mocks
    const mockGenerator = new MockGenerator();
    const mocks = await mockGenerator.generate(analysis, scenario, existingScenario);

    // Start the server
    const port = parseInt(options.port, 10);
    console.log(chalk.gray('  Bundling...'));

    const { url, close } = await startPreviewServer({
      port,
      projectRoot,
      analysis,
      mocks,
      scenario,
      mockGenerator,
    });

    console.log('');
    console.log(chalk.green.bold(`  ${url}`));
    console.log('');
    console.log(chalk.gray('  scenario:  ') + scenario);
    console.log(chalk.gray('  mocks:     ') + Object.keys(mocks.apiMocks).length + ' endpoints');
    if (mocks.auth.isAuthenticated) {
      console.log(chalk.gray('  auth:      ') + `${mocks.auth.user?.name}`);
    }
    if (Object.keys(mocks.routeParams).length > 0) {
      console.log(chalk.gray('  params:    ') + Object.entries(mocks.routeParams).map(([k, v]) => `${k}=${v}`).join(', '));
    }
    console.log('');
    console.log(chalk.gray('  Ctrl+C to stop'));
    console.log('');

    // Handle shutdown
    process.on('SIGINT', () => {
      console.log('');
      console.log(chalk.gray('  Stopped.'));
      close();
      const outputDir = path.join(projectRoot, '.state-render');
      if (fs.existsSync(outputDir)) {
        fs.rmSync(outputDir, { recursive: true, force: true });
      }
      process.exit(0);
    });
  });

function printAnalysis(analysis: import('../core/analyzer/types').AnalysisResult): void {
  console.log('');
  console.log(chalk.bold('  Analysis'));
  console.log(chalk.gray('  ─'.repeat(25)));
  console.log(chalk.gray('  Framework:  ') + analysis.framework);
  console.log(chalk.gray('  Component:  ') + (analysis.exportedComponent || 'default'));
  console.log(chalk.gray('  Client:     ') + (analysis.isClientComponent ? 'yes' : 'no'));

  if (analysis.apiCalls.length > 0) {
    console.log('');
    console.log(chalk.gray('  API Calls:'));
    for (const call of analysis.apiCalls) {
      console.log(chalk.gray(`    ${call.method} ${call.endpoint}`) + chalk.gray(` (${call.source}:${call.line})`));
    }
  }

  if (analysis.authDependencies.length > 0) {
    console.log('');
    console.log(chalk.gray('  Auth:'));
    for (const auth of analysis.authDependencies) {
      console.log(chalk.gray(`    ${auth.source}`) + chalk.gray(` (${auth.type}:${auth.line})`));
    }
  }

  if (analysis.routeParams.length > 0) {
    console.log(chalk.gray('  Params:     ') + analysis.routeParams.map(p => `[${p.name}]`).join(', '));
  }

  if (analysis.contextDependencies.length > 0) {
    console.log('');
    console.log(chalk.gray('  Context:'));
    for (const ctx of analysis.contextDependencies) {
      console.log(chalk.gray(`    ${ctx.hook}`) + (ctx.accessedProperties.length > 0 ? chalk.gray(` -> ${ctx.accessedProperties.join(', ')}`) : ''));
    }
  }

  if (analysis.hooks.length > 0 && analysis.hooks.some(h => !['useParams', 'useRouter', 'useSearchParams', 'usePathname', 'useSession', 'useAuth'].includes(h.name))) {
    console.log('');
    console.log(chalk.gray('  Hooks:'));
    for (const hook of analysis.hooks.filter(h => !['useParams', 'useRouter', 'useSearchParams', 'usePathname', 'useSession', 'useAuth'].includes(h.name))) {
      console.log(chalk.gray(`    ${hook.name}`) + chalk.gray(`:${hook.line}`));
    }
  }

  console.log('');
}

program.parse();
