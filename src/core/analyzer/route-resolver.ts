import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import { RouteParam } from './types';

export interface ResolvedRoute {
  filePath: string;
  routeParams: RouteParam[];
  routerType: 'app' | 'pages' | 'component';
  layoutFiles: string[];
}

export interface ResolvedInput {
  filePath: string;
  projectRoot: string;
  routePattern: string;
  routeParams: RouteParam[];
  routerType: 'app' | 'pages' | 'component';
  layoutFiles: string[];
  mode: 'route' | 'file';
}

/**
 * Smart input resolver. Accepts any of:
 *   - Route pattern:      /dashboard/projects/[id]
 *   - Relative file path: src/app/dashboard/page.tsx
 *   - Absolute file path: /Users/you/project/src/app/dashboard/page.tsx  (drag-and-drop)
 *
 * Automatically detects whether the input is a file or a route,
 * finds the project root, and extracts route params.
 */
export async function resolveInput(
  input: string,
  explicitProjectRoot?: string
): Promise<ResolvedInput | null> {
  // --- Mode 1: Input is an existing file path ---
  const asAbsolute = path.isAbsolute(input) ? input : path.resolve(input);

  if (looksLikeFilePath(input)) {
    // Try resolving it as a file (with or without extension)
    const filePath = await resolveFilePath(input);
    if (filePath) {
      const projectRoot = explicitProjectRoot
        ? path.resolve(explicitProjectRoot)
        : findProjectRoot(filePath);
      const { routePattern, routeParams, routerType, layoutFiles } = inferRouteFromFile(filePath, projectRoot);
      return {
        filePath,
        projectRoot,
        routePattern,
        routeParams,
        routerType,
        layoutFiles,
        mode: 'file',
      };
    }
  }

  // --- Mode 2: Input is a route pattern ---
  const projectRoot = path.resolve(explicitProjectRoot || '.');
  const resolved = await resolveRoute(input, projectRoot);
  if (resolved) {
    const routePattern = input.startsWith('/') ? input : `/${input}`;
    return {
      filePath: resolved.filePath,
      projectRoot,
      routePattern,
      routeParams: resolved.routeParams,
      routerType: resolved.routerType,
      layoutFiles: resolved.layoutFiles,
      mode: 'route',
    };
  }

  return null;
}

/**
 * Checks whether the input looks like a file path rather than a route pattern.
 * File paths have extensions or contain recognizable directory markers.
 */
function looksLikeFilePath(input: string): boolean {
  // Has a source file extension
  if (/\.(tsx?|jsx?|mjs|cjs)$/.test(input)) return true;
  // Is an absolute path
  if (path.isAbsolute(input)) return true;
  // Starts with ./ or ../
  if (input.startsWith('./') || input.startsWith('../')) return true;
  // Contains src/, app/, pages/, components/ — likely a file path
  if (/\b(src|app|pages|components|lib|utils)\//.test(input)) return true;
  return false;
}

/**
 * Resolves a file path input, trying extensions if needed.
 */
async function resolveFilePath(input: string): Promise<string | null> {
  const abs = path.isAbsolute(input) ? input : path.resolve(input);

  // Direct match
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;

  // Try adding extensions
  const extensions = ['.tsx', '.ts', '.jsx', '.js'];
  for (const ext of extensions) {
    const withExt = abs + ext;
    if (fs.existsSync(withExt)) return withExt;
  }

  // If it's a directory, look for page.* or index.*
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    for (const name of ['page', 'index']) {
      for (const ext of extensions) {
        const candidate = path.join(abs, name + ext);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  return null;
}

/**
 * Walk up from a file to find the project root (directory with package.json).
 */
export function findProjectRoot(fromPath: string): string {
  let dir = path.dirname(fromPath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback to cwd
  return process.cwd();
}

/**
 * Given a resolved file path and project root, infer the route pattern
 * and extract route params from the path segments.
 */
function inferRouteFromFile(
  filePath: string,
  projectRoot: string
): { routePattern: string; routeParams: RouteParam[]; routerType: ResolvedRoute['routerType']; layoutFiles: string[] } {
  const relative = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  // Try to match app router: (src/)app/.../page.tsx
  const appMatch = relative.match(/^(?:src\/)?app\/(.+)\/page\.\w+$/);
  if (appMatch) {
    const routePath = '/' + appMatch[1];
    const segments = appMatch[1].split('/');
    const routeParams = extractRouteParams(segments);
    // Find the app root for layout detection
    const appRootRel = relative.startsWith('src/app') ? 'src/app' : 'app';
    const appRoot = path.join(projectRoot, appRootRel);
    const layoutFiles = findLayoutFiles(appRoot, segments);
    return { routePattern: routePath, routeParams, routerType: 'app', layoutFiles };
  }

  // Try to match pages router: (src/)pages/.../index.tsx or .../name.tsx
  const pagesMatch = relative.match(/^(?:src\/)?pages\/(.+)\.\w+$/);
  if (pagesMatch) {
    let routePath = '/' + pagesMatch[1];
    routePath = routePath.replace(/\/index$/, '') || '/';
    const segments = pagesMatch[1].replace(/\/index$/, '').split('/').filter(Boolean);
    const routeParams = extractRouteParams(segments);
    return { routePattern: routePath, routeParams, routerType: 'pages', layoutFiles: [] };
  }

  // Not a page file — treat as a standalone component
  return { routePattern: '/' + relative, routeParams: [], routerType: 'component', layoutFiles: [] };
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
