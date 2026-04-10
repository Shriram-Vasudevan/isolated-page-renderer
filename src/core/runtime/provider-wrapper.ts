import { AnalysisResult } from '../analyzer/types';
import { GeneratedMocks } from '../mocker/types';

/**
 * Generates the React wrapper component that provides all necessary
 * context providers for isolated rendering.
 */
export function generateProviderWrapper(
  analysis: AnalysisResult,
  mocks: GeneratedMocks
): string {
  const imports: string[] = [];
  const providers: { open: string; close: string }[] = [];

  // Detect what providers are needed
  const needsRouter = analysis.contextDependencies.some(
    d => d.hook === 'useRouter' || d.hook === 'usePathname' || d.hook === 'useSearchParams' || d.hook === 'useParams'
  );

  const needsSession = analysis.authDependencies.some(
    d => d.source === 'useSession'
  );

  const hasTheme = analysis.contextDependencies.some(
    d => d.hook === 'useTheme'
  );

  // Build the wrapper
  let wrapper = `
'use client';
import React from 'react';
`;

  // Next.js router mock provider
  if (needsRouter || analysis.framework.startsWith('nextjs')) {
    wrapper += `
// Mock Next.js navigation
const MockRouterContext = React.createContext({
  push: (url) => { console.log('[state-render] router.push:', url); },
  replace: (url) => { console.log('[state-render] router.replace:', url); },
  back: () => { console.log('[state-render] router.back()'); },
  forward: () => { console.log('[state-render] router.forward()'); },
  refresh: () => { console.log('[state-render] router.refresh()'); },
  prefetch: () => {},
  pathname: '${buildPathname(analysis, mocks)}',
  query: ${JSON.stringify(mocks.queryParams)},
  asPath: '${buildPathname(analysis, mocks)}',
  route: '${buildRoutePattern(analysis)}',
  isReady: true,
  locale: 'en',
});

// Override useRouter
const originalReact = { ...React };
const originalCreateContext = React.createContext;
`;
  }

  // Session provider
  if (needsSession) {
    wrapper += `
// Mock SessionProvider
function MockSessionProvider({ children }) {
  const session = window.__NEXT_AUTH_SESSION__;
  const SessionContext = React.createContext(undefined);

  return React.createElement(
    SessionContext.Provider,
    { value: session },
    children
  );
}
`;
    providers.push({
      open: 'React.createElement(MockSessionProvider, null,',
      close: ')',
    });
  }

  // Theme provider mock
  if (hasTheme) {
    wrapper += `
function MockThemeProvider({ children }) {
  return React.createElement(
    React.createContext({ theme: 'light', setTheme: () => {} }).Provider,
    { value: { theme: 'light', setTheme: () => {}, resolvedTheme: 'light' } },
    children
  );
}
`;
    providers.push({
      open: 'React.createElement(MockThemeProvider, null,',
      close: ')',
    });
  }

  // Custom context providers
  for (const dep of analysis.contextDependencies) {
    if (['useRouter', 'usePathname', 'useSearchParams', 'useParams', 'useTheme'].includes(dep.hook)) {
      continue; // handled above
    }
    if (dep.hook === 'useContext') {
      const mockValue: Record<string, unknown> = {};
      for (const prop of dep.accessedProperties) {
        mockValue[prop] = `mock_${prop}`;
      }
      wrapper += `
const Mock${dep.name}Value = ${JSON.stringify(mockValue)};
`;
    }
  }

  // Build the IsolatedWrapper component
  wrapper += `
export default function IsolatedWrapper({ children }) {
  return (
    ${providers.length > 0
      ? providers.reduce(
          (inner, p) => `${p.open}\n      ${inner}\n    ${p.close}`,
          'React.createElement(React.Fragment, null, children)'
        )
      : 'React.createElement(React.Fragment, null, children)'
    }
  );
}
`;

  return wrapper;
}

function buildPathname(analysis: AnalysisResult, mocks: GeneratedMocks): string {
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

function buildRoutePattern(analysis: AnalysisResult): string {
  return analysis.filePath
    .replace(/.*\/(app|pages)\//, '/')
    .replace(/\/page\.(tsx|ts|jsx|js)$/, '')
    .replace(/\/index\.(tsx|ts|jsx|js)$/, '');
}
