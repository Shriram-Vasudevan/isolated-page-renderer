import express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AnalysisResult } from '../analyzer/types';
import { GeneratedMocks, Scenario } from '../mocker/types';
import { generateClientRuntime } from '../runtime/client-runtime';
import { bundleComponent } from './bundler';
import { MockGenerator } from '../mocker';
import chalk from 'chalk';

export interface ServerOptions {
  port: number;
  projectRoot: string;
  analysis: AnalysisResult;
  mocks: GeneratedMocks;
  scenario: Scenario;
  mockGenerator: MockGenerator;
}

export async function startPreviewServer(options: ServerOptions): Promise<{
  url: string;
  close: () => void;
}> {
  const { port, projectRoot, analysis, scenario, mockGenerator } = options;
  let { mocks } = options;

  const outputDir = path.join(projectRoot, '.state-render');
  const app = express();

  // Bundle the component
  console.log(chalk.blue('  Bundling component...'));
  const { bundlePath } = await bundleComponent(analysis, mocks, outputDir, projectRoot);

  // Generate the runtime script
  const runtimeScript = generateClientRuntime({
    apiMocks: mocks.apiMocks,
    auth: mocks.auth,
    routeParams: mocks.routeParams,
    queryParams: mocks.queryParams,
    scenario,
  });
  fs.writeFileSync(path.join(outputDir, 'runtime.js'), runtimeScript);

  // Generate the HTML page
  const html = generatePreviewHtml(analysis, scenario);
  fs.writeFileSync(path.join(outputDir, 'index.html'), html);

  // Serve static files
  app.use('/__sr', express.static(outputDir));

  // Serve the target project's public directory
  const publicDir = path.join(projectRoot, 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  }

  // Serve node_modules for CSS etc
  app.use('/node_modules', express.static(path.join(projectRoot, 'node_modules')));

  // API fallback — if a fetch slips past the client interceptor, return JSON not HTML
  app.all('/api/*', (req, res) => {
    console.log(chalk.yellow(`  [fallback] Unintercepted API call: ${req.method} ${req.url}`));
    res.status(200).json({
      _stateRender: true,
      message: 'This API call was not intercepted by the client runtime. Check mock endpoint patterns.',
      method: req.method,
      url: req.url,
    });
  });

  // Main page route - serve the preview
  app.get('*', (req, res) => {
    // Serve the preview HTML for all routes (SPA-style)
    if (req.path.startsWith('/__sr')) return;
    res.sendFile(path.join(outputDir, 'index.html'));
  });

  // Create HTTP server
  const server = http.createServer(app);

  // WebSocket for live reload and scenario switching
  const wss = new WebSocketServer({ server, path: '/__sr_ws' });
  const clients: Set<WebSocket> = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'switch-scenario') {
          const newScenario = msg.scenario as Scenario;
          console.log(chalk.yellow(`  Switching to scenario: ${newScenario}`));

          // Regenerate mocks for new scenario
          mocks = await mockGenerator.generate(analysis, newScenario);

          // Rebuild
          await bundleComponent(analysis, mocks, outputDir, projectRoot);
          const newRuntime = generateClientRuntime({
            apiMocks: mocks.apiMocks,
            auth: mocks.auth,
            routeParams: mocks.routeParams,
            queryParams: mocks.queryParams,
            scenario: newScenario,
          });
          fs.writeFileSync(path.join(outputDir, 'runtime.js'), newRuntime);
          fs.writeFileSync(path.join(outputDir, 'index.html'), generatePreviewHtml(analysis, newScenario));

          // Notify all clients to reload
          for (const client of clients) {
            if (client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({ type: 'reload' }));
            }
          }
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => clients.delete(ws));
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      resolve({
        url,
        close: () => {
          server.close();
          wss.close();
        },
      });
    });
  });
}

function generatePreviewHtml(analysis: AnalysisResult, scenario: Scenario): string {
  const componentName = analysis.exportedComponent || path.basename(analysis.filePath, path.extname(analysis.filePath));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>state-render | ${componentName} [${scenario}]</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 0; }

    #sr-loading {
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: #fff;
      color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 100000;
      transition: opacity 0.3s;
    }
    @media (prefers-color-scheme: dark) {
      #sr-loading { background: #111; color: #e5e5e5; }
      .sr-spinner { border-color: #333 !important; border-top-color: #888 !important; }
    }
    #sr-loading.hidden { opacity: 0; pointer-events: none; }
    .sr-spinner {
      width: 20px; height: 20px;
      border: 2px solid #e5e5e5;
      border-top-color: #888;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin-bottom: 14px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="sr-loading">
    <div style="text-align: center;">
      <div class="sr-spinner" style="margin:0 auto 14px;"></div>
      <div style="font-size:13px;font-weight:500;">${componentName}</div>
      <div style="color:#999;margin-top:4px;font-size:12px;">${scenario}</div>
    </div>
  </div>

  <div id="root"></div>

  <!-- Runtime intercepts (must load before the component bundle) -->
  <script src="/__sr/runtime.js"></script>

  <!-- Component bundle -->
  <script type="module" src="/__sr/bundle.js" onload="document.getElementById('sr-loading').classList.add('hidden')"></script>

  <script>
    // Hide loading after timeout even if onload doesn't fire
    setTimeout(function() {
      var el = document.getElementById('sr-loading');
      if (el) el.classList.add('hidden');
    }, 5000);

    // Error handling
    window.addEventListener('error', function(e) {
      console.error('[state-render] Runtime error:', e.error);
      var el = document.getElementById('sr-loading');
      if (el) {
        el.innerHTML = '<div style="text-align:center;max-width:520px;padding:20px;">' +
          '<div style="font-size:14px;font-weight:600;margin-bottom:12px;">Render Error</div>' +
          '<pre style="background:#f5f5f5;border:1px solid #e5e5e5;padding:14px;border-radius:6px;' +
          'text-align:left;overflow:auto;white-space:pre-wrap;font-size:12px;color:#666;line-height:1.5;">' +
          e.message + '</pre></div>';
        el.classList.remove('hidden');
      }
    });
  </script>
</body>
</html>`;
}
