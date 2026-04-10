import * as esbuild from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';
import { AnalysisResult } from '../analyzer/types';
import { GeneratedMocks } from '../mocker/types';

/**
 * Bundles the target component with all its dependencies into a single
 * browser-ready bundle using esbuild.
 */
export async function bundleComponent(
  analysis: AnalysisResult,
  mocks: GeneratedMocks,
  outputDir: string,
  projectRoot: string
): Promise<{ entryHtml: string; bundlePath: string }> {
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate the entry point that renders the component
  const entryCode = generateEntryPoint(analysis, mocks);
  const entryPath = path.join(outputDir, '_sr_entry.tsx');
  fs.writeFileSync(entryPath, entryCode);

  // Generate mock module overrides
  const mockModules = generateMockModules(analysis, mocks, outputDir);

  // Build with esbuild
  const bundlePath = path.join(outputDir, 'bundle.js');

  try {
    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      outfile: bundlePath,
      format: 'esm',
      platform: 'browser',
      target: 'es2020',
      jsx: 'automatic',
      jsxImportSource: 'react',
      loader: {
        '.tsx': 'tsx',
        '.ts': 'ts',
        '.jsx': 'jsx',
        '.js': 'jsx',
        '.css': 'css',
        '.module.css': 'css',
        '.svg': 'dataurl',
        '.png': 'dataurl',
        '.jpg': 'dataurl',
        '.gif': 'dataurl',
        '.woff': 'dataurl',
        '.woff2': 'dataurl',
      },
      define: {
        'process.env.NODE_ENV': '"development"',
        'process.env': '{}',
      },
      alias: {
        // Mock Next.js modules
        'next/navigation': path.join(outputDir, '_sr_mock_next_navigation.js'),
        'next/router': path.join(outputDir, '_sr_mock_next_router.js'),
        'next/image': path.join(outputDir, '_sr_mock_next_image.js'),
        'next/link': path.join(outputDir, '_sr_mock_next_link.js'),
        'next/head': path.join(outputDir, '_sr_mock_next_head.js'),
        'next-auth/react': path.join(outputDir, '_sr_mock_next_auth.js'),
        'next/font/google': path.join(outputDir, '_sr_mock_next_font.js'),
        'next/font/local': path.join(outputDir, '_sr_mock_next_font.js'),
        // Alias @ to project src
        ...resolvePathAliases(projectRoot),
        ...mockModules.aliases,
      },
      external: [],
      logLevel: 'warning',
      sourcemap: true,
      // Handle CSS modules
      plugins: [
        cssModulesPlugin(),
        serverOnlyPlugin(),
      ],
    });
  } catch (err) {
    console.error('Bundle failed:', err);
    // Write a fallback bundle with error display
    const fallbackBundle = generateErrorBundle(analysis, err);
    fs.writeFileSync(bundlePath, fallbackBundle);
  }

  // Generate the HTML shell
  const entryHtml = path.join(outputDir, 'index.html');

  return { entryHtml, bundlePath };
}

function generateEntryPoint(analysis: AnalysisResult, mocks: GeneratedMocks): string {
  const componentPath = analysis.filePath;
  const isServer = analysis.isServerComponent;

  let code = `
import React from 'react';
import { createRoot } from 'react-dom/client';
`;

  // Import the target component
  code += `import TargetComponent from '${componentPath}';\n`;

  // Build props for the component
  const props: Record<string, unknown> = {};

  // For App Router pages, the component receives params and searchParams as props
  if (analysis.framework === 'nextjs-app') {
    if (analysis.routeParams.length > 0) {
      props['params'] = mocks.routeParams;
    }
    if (analysis.queryParams.length > 0) {
      props['searchParams'] = mocks.queryParams;
    }
  }

  // For Pages Router, inject router query
  if (analysis.framework === 'nextjs-pages') {
    // Props come from getServerSideProps/getStaticProps - we'll pass mock data
  }

  // Add component props
  for (const [key, value] of Object.entries(analysis.componentProps)) {
    if (!(key in props)) {
      props[key] = inferPropValue(key, value);
    }
  }

  code += `
const mockProps = ${JSON.stringify(props, null, 2)};

function App() {
  return (
    <React.Suspense fallback={
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontFamily: 'system-ui'
      }}>
        <div>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>Loading...</div>
          <div style={{ color: '#666' }}>state-render is preparing the preview</div>
        </div>
      </div>
    }>
      <TargetComponent {...mockProps} />
    </React.Suspense>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
`;

  return code;
}

function generateMockModules(
  analysis: AnalysisResult,
  mocks: GeneratedMocks,
  outputDir: string
): { aliases: Record<string, string> } {
  const aliases: Record<string, string> = {};

  // Mock next/navigation
  const navMock = `
import React from 'react';

const routeParams = ${JSON.stringify(mocks.routeParams)};
const queryParams = ${JSON.stringify(mocks.queryParams)};

export function useRouter() {
  return {
    push: (url) => console.log('[state-render] router.push:', url),
    replace: (url) => console.log('[state-render] router.replace:', url),
    back: () => console.log('[state-render] router.back()'),
    forward: () => console.log('[state-render] router.forward()'),
    refresh: () => window.location.reload(),
    prefetch: () => Promise.resolve(),
  };
}

export function usePathname() {
  return '${buildPathnameFromAnalysis(analysis, mocks)}';
}

export function useSearchParams() {
  const params = new URLSearchParams(${JSON.stringify(mocks.queryParams)});
  return params;
}

export function useParams() {
  return ${JSON.stringify(mocks.routeParams)};
}

export function redirect(url) {
  console.log('[state-render] redirect:', url);
}

export function notFound() {
  throw new Error('Not Found (mocked)');
}

export function useSelectedLayoutSegment() { return null; }
export function useSelectedLayoutSegments() { return []; }
`;
  fs.writeFileSync(path.join(outputDir, '_sr_mock_next_navigation.js'), navMock);

  // Mock next/router (Pages Router)
  const routerMock = `
import React from 'react';

const mockRouter = {
  pathname: '${buildPathnameFromAnalysis(analysis, mocks)}',
  query: ${JSON.stringify({ ...mocks.routeParams, ...mocks.queryParams })},
  asPath: '${buildPathnameFromAnalysis(analysis, mocks)}',
  route: '${buildRoutePatternFromAnalysis(analysis)}',
  push: (url) => { console.log('[state-render] router.push:', url); return Promise.resolve(true); },
  replace: (url) => { console.log('[state-render] router.replace:', url); return Promise.resolve(true); },
  back: () => console.log('[state-render] router.back()'),
  reload: () => window.location.reload(),
  prefetch: () => Promise.resolve(),
  beforePopState: () => {},
  events: { on: () => {}, off: () => {}, emit: () => {} },
  isFallback: false,
  isReady: true,
  isPreview: false,
  isLocaleDomain: false,
  locale: 'en',
  locales: ['en'],
  defaultLocale: 'en',
  basePath: '',
};

export function useRouter() { return mockRouter; }
export function withRouter(Component) {
  return function WithRouterWrapper(props) {
    return React.createElement(Component, { ...props, router: mockRouter });
  };
}
export default { useRouter, withRouter };
`;
  fs.writeFileSync(path.join(outputDir, '_sr_mock_next_router.js'), routerMock);

  // Mock next/image
  const imageMock = `
import React from 'react';
function NextImage({ src, alt, width, height, fill, ...props }) {
  const style = fill
    ? { objectFit: 'cover', width: '100%', height: '100%' }
    : { width, height };
  return React.createElement('img', {
    src: typeof src === 'string' ? src : src?.src || '',
    alt: alt || '',
    style,
    ...props,
  });
}
export default NextImage;
export { NextImage as Image };
`;
  fs.writeFileSync(path.join(outputDir, '_sr_mock_next_image.js'), imageMock);

  // Mock next/link
  const linkMock = `
import React from 'react';
function NextLink({ href, children, ...props }) {
  return React.createElement('a', {
    href: typeof href === 'string' ? href : href?.pathname || '#',
    onClick: (e) => { e.preventDefault(); console.log('[state-render] Link clicked:', href); },
    ...props,
  }, children);
}
export default NextLink;
`;
  fs.writeFileSync(path.join(outputDir, '_sr_mock_next_link.js'), linkMock);

  // Mock next/head
  const headMock = `
import React from 'react';
function Head({ children }) { return null; }
export default Head;
`;
  fs.writeFileSync(path.join(outputDir, '_sr_mock_next_head.js'), headMock);

  // Mock next-auth/react
  const authMock = `
import React from 'react';

const mockSession = ${JSON.stringify(
    mocks.auth.isAuthenticated
      ? {
          data: {
            user: mocks.auth.user,
            expires: new Date(Date.now() + 86400000).toISOString(),
            ...mocks.auth.session,
          },
          status: 'authenticated',
        }
      : { data: null, status: 'unauthenticated' }
  )};

export function useSession() {
  return mockSession;
}

export function SessionProvider({ children }) {
  return children;
}

export function signIn(provider) {
  console.log('[state-render] signIn called with:', provider);
  return Promise.resolve({ ok: true });
}

export function signOut() {
  console.log('[state-render] signOut called');
  return Promise.resolve();
}

export function getSession() {
  return Promise.resolve(mockSession.data);
}

export function getCsrfToken() {
  return Promise.resolve('mock-csrf-token');
}
`;
  fs.writeFileSync(path.join(outputDir, '_sr_mock_next_auth.js'), authMock);

  // Mock next/font
  const fontMock = `
export default function font() {
  return {
    className: 'mock-font',
    style: { fontFamily: 'system-ui, sans-serif' },
    variable: '--font-mock',
  };
}
export function Inter() { return font(); }
export function Roboto() { return font(); }
`;
  fs.writeFileSync(path.join(outputDir, '_sr_mock_next_font.js'), fontMock);

  return { aliases };
}

function resolvePathAliases(projectRoot: string): Record<string, string> {
  const aliases: Record<string, string> = {};

  // Read tsconfig for path aliases
  const tsconfigPaths = [
    path.join(projectRoot, 'tsconfig.json'),
    path.join(projectRoot, 'jsconfig.json'),
  ];

  for (const configPath of tsconfigPaths) {
    if (!fs.existsSync(configPath)) continue;
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      // Strip comments from JSON
      const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const config = JSON.parse(cleaned);
      const paths = config.compilerOptions?.paths;
      const baseUrl = config.compilerOptions?.baseUrl || '.';

      if (paths) {
        for (const [alias, targets] of Object.entries(paths)) {
          if (Array.isArray(targets) && targets.length > 0) {
            const cleanAlias = alias.replace('/*', '');
            const cleanTarget = (targets[0] as string).replace('/*', '');
            aliases[cleanAlias] = path.resolve(projectRoot, baseUrl, cleanTarget);
          }
        }
      }

      // Common convention: @ -> src/
      if (!aliases['@']) {
        const srcDir = path.join(projectRoot, 'src');
        if (fs.existsSync(srcDir)) {
          aliases['@'] = srcDir;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return aliases;
}

function cssModulesPlugin(): esbuild.Plugin {
  return {
    name: 'css-modules',
    setup(build) {
      // Handle CSS module imports by returning an empty object
      build.onResolve({ filter: /\.module\.css$/ }, (args) => {
        return { path: args.path, namespace: 'css-module' };
      });
      build.onLoad({ filter: /.*/, namespace: 'css-module' }, () => {
        return {
          contents: 'export default new Proxy({}, { get: (_, name) => name });',
          loader: 'js',
        };
      });

      // Handle regular CSS imports
      build.onResolve({ filter: /\.css$/ }, (args) => {
        if (args.namespace === 'css-module') return undefined;
        return undefined; // let esbuild handle it
      });
    },
  };
}

function serverOnlyPlugin(): esbuild.Plugin {
  return {
    name: 'server-only-stub',
    setup(build) {
      // Stub out server-only imports
      build.onResolve({ filter: /^server-only$/ }, () => {
        return { path: 'server-only', namespace: 'server-only-stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'server-only-stub' }, () => {
        return { contents: '', loader: 'js' };
      });

      // Stub out next/server
      build.onResolve({ filter: /^next\/server$/ }, () => {
        return { path: 'next/server', namespace: 'next-server-stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'next-server-stub' }, () => {
        return {
          contents: `
            export class NextResponse {
              static json(data, init) { return new Response(JSON.stringify(data), init); }
              static redirect(url) { return new Response(null, { status: 302, headers: { Location: url } }); }
            }
            export class NextRequest extends Request {}
          `,
          loader: 'js',
        };
      });
    },
  };
}

function generateErrorBundle(analysis: AnalysisResult, error: unknown): string {
  const errMsg = error instanceof Error ? error.message : String(error);
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';

function ErrorDisplay() {
  return React.createElement('div', {
    style: {
      fontFamily: 'monospace', padding: '40px', maxWidth: '800px', margin: '0 auto',
      background: '#1e1e2e', color: '#cdd6f4', minHeight: '100vh',
    }
  },
    React.createElement('h1', { style: { color: '#f38ba8' } }, 'Bundle Error'),
    React.createElement('p', null, 'state-render failed to bundle the component:'),
    React.createElement('pre', {
      style: { background: '#313244', padding: '16px', borderRadius: '8px', overflow: 'auto', whiteSpace: 'pre-wrap' }
    }, ${JSON.stringify(errMsg)}),
    React.createElement('h3', { style: { color: '#89b4fa', marginTop: '24px' } }, 'Target File'),
    React.createElement('code', null, '${analysis.filePath}'),
    React.createElement('h3', { style: { color: '#89b4fa', marginTop: '24px' } }, 'What to try'),
    React.createElement('ul', null,
      React.createElement('li', null, 'Check that all dependencies are installed in the target project'),
      React.createElement('li', null, 'Ensure the component can be imported as a module'),
      React.createElement('li', null, 'Check for server-only code that cannot run in the browser'),
    )
  );
}

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(ErrorDisplay));
`;
}

function buildPathnameFromAnalysis(analysis: AnalysisResult, mocks: GeneratedMocks): string {
  const segments = analysis.filePath
    .replace(/.*\/(app|pages)\//, '/')
    .replace(/\/page\.(tsx|ts|jsx|js)$/, '')
    .replace(/\/index\.(tsx|ts|jsx|js)$/, '')
    .split('/');

  return segments
    .map(segment => {
      if (segment.startsWith('[') && segment.endsWith(']')) {
        const paramName = segment.slice(1, -1).replace('...', '');
        return mocks.routeParams[paramName] ?? 'mock-param';
      }
      return segment;
    })
    .join('/') || '/';
}

function buildRoutePatternFromAnalysis(analysis: AnalysisResult): string {
  return analysis.filePath
    .replace(/.*\/(app|pages)\//, '/')
    .replace(/\/page\.(tsx|ts|jsx|js)$/, '')
    .replace(/\/index\.(tsx|ts|jsx|js)$/, '');
}

function inferPropValue(key: string, type: string): unknown {
  switch (type) {
    case 'string': return `mock-${key}`;
    case 'number': return 42;
    case 'boolean': return true;
    default: return `mock-${key}`;
  }
}
