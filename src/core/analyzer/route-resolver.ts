import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import { RouteParam } from './types';

export interface ResolvedRoute {
  filePath: string;
  routeParams: RouteParam[];
  routerType: 'app' | 'pages';
  layoutFiles: string[];
}

/**
 * Resolves a route pattern (e.g. /dashboard/projects/[id]) to a file path
 * in a Next.js project.
 */
export async function resolveRoute(
  routePattern: string,
  projectRoot: string
): Promise<ResolvedRoute | null> {
  // Normalize the route
  const route = routePattern.startsWith('/') ? routePattern : `/${routePattern}`;
  const segments = route.split('/').filter(Boolean);

  // Try App Router first
  const appResult = await tryAppRouter(segments, projectRoot);
  if (appResult) return appResult;

  // Try Pages Router
  const pagesResult = await tryPagesRouter(segments, projectRoot);
  if (pagesResult) return pagesResult;

  return null;
}

/**
 * Resolves a component file path directly.
 */
export async function resolveComponent(
  componentPath: string,
  projectRoot: string
): Promise<string | null> {
  const extensions = ['.tsx', '.ts', '.jsx', '.js'];
  const candidates = [
    componentPath,
    ...extensions.map(ext => componentPath + ext),
    ...extensions.map(ext => path.join(componentPath, `index${ext}`)),
  ];

  for (const candidate of candidates) {
    const fullPath = path.isAbsolute(candidate)
      ? candidate
      : path.join(projectRoot, candidate);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

async function tryAppRouter(
  segments: string[],
  projectRoot: string
): Promise<ResolvedRoute | null> {
  const appDirs = ['app', 'src/app'];

  for (const appDir of appDirs) {
    const appRoot = path.join(projectRoot, appDir);
    if (!fs.existsSync(appRoot)) continue;

    // Build the expected file path
    const routePath = segments.join('/');
    const pageFiles = ['page.tsx', 'page.ts', 'page.jsx', 'page.js'];

    for (const pageFile of pageFiles) {
      const fullPath = path.join(appRoot, routePath, pageFile);
      if (fs.existsSync(fullPath)) {
        const routeParams = extractRouteParams(segments);
        const layoutFiles = findLayoutFiles(appRoot, segments);
        return {
          filePath: fullPath,
          routeParams,
          routerType: 'app',
          layoutFiles,
        };
      }
    }

    // Try with glob for catch-all routes
    const pattern = segments
      .map(s => {
        if (s.startsWith('[') && s.endsWith(']')) return '*';
        return s;
      })
      .join('/');

    for (const pageFile of pageFiles) {
      const matches = await glob(path.join(appRoot, pattern, pageFile));
      if (matches.length > 0) {
        const routeParams = extractRouteParams(segments);
        const layoutFiles = findLayoutFiles(appRoot, segments);
        return {
          filePath: matches[0],
          routeParams,
          routerType: 'app',
          layoutFiles,
        };
      }
    }
  }

  return null;
}

async function tryPagesRouter(
  segments: string[],
  projectRoot: string
): Promise<ResolvedRoute | null> {
  const pagesDirs = ['pages', 'src/pages'];

  for (const pagesDir of pagesDirs) {
    const pagesRoot = path.join(projectRoot, pagesDir);
    if (!fs.existsSync(pagesRoot)) continue;

    const routePath = segments.join('/');
    const extensions = ['.tsx', '.ts', '.jsx', '.js'];

    for (const ext of extensions) {
      // Try direct file match
      const directPath = path.join(pagesRoot, routePath + ext);
      if (fs.existsSync(directPath)) {
        return {
          filePath: directPath,
          routeParams: extractRouteParams(segments),
          routerType: 'pages',
          layoutFiles: [],
        };
      }

      // Try index file
      const indexPath = path.join(pagesRoot, routePath, `index${ext}`);
      if (fs.existsSync(indexPath)) {
        return {
          filePath: indexPath,
          routeParams: extractRouteParams(segments),
          routerType: 'pages',
          layoutFiles: [],
        };
      }
    }
  }

  return null;
}

function extractRouteParams(segments: string[]): RouteParam[] {
  const params: RouteParam[] = [];

  for (const segment of segments) {
    if (segment.startsWith('[') && segment.endsWith(']')) {
      const name = segment.slice(1, -1).replace('...', '');
      params.push({
        name,
        isDynamic: true,
        inferredType: 'string',
      });
    }
  }

  return params;
}

function findLayoutFiles(appRoot: string, segments: string[]): string[] {
  const layouts: string[] = [];
  const layoutNames = ['layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js'];

  // Check root layout
  for (const name of layoutNames) {
    const rootLayout = path.join(appRoot, name);
    if (fs.existsSync(rootLayout)) {
      layouts.push(rootLayout);
      break;
    }
  }

  // Check each segment's layout
  let currentPath = appRoot;
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    for (const name of layoutNames) {
      const layoutPath = path.join(currentPath, name);
      if (fs.existsSync(layoutPath)) {
        layouts.push(layoutPath);
        break;
      }
    }
  }

  return layouts;
}
