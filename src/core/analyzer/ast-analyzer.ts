import * as fs from 'fs';
import * as path from 'path';
import { parse } from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  AnalysisResult,
  ApiCall,
  AuthDependency,
  ContextDependency,
  HookUsage,
  ImportInfo,
  QueryParam,
  RouteParam,
} from './types';

const AUTH_HOOKS = new Set([
  'useSession',
  'useAuth',
  'useUser',
  'useClerk',
  'useSupabaseClient',
  'getServerSession',
  'getSession',
  'auth',
  'currentUser',
]);

const DATA_FETCHING_HOOKS = new Set([
  'useQuery',
  'useSWR',
  'useMutation',
  'useInfiniteQuery',
  'useSuspenseQuery',
]);

const CONTEXT_HOOKS = new Set([
  'useContext',
  'useTheme',
  'useRouter',
  'usePathname',
  'useSearchParams',
  'useParams',
]);

export function analyzeFile(filePath: string, routeParams: RouteParam[] = []): AnalysisResult {
  const sourceCode = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);
  const isTypeScript = ext === '.ts' || ext === '.tsx';
  const isJSX = ext === '.tsx' || ext === '.jsx';

  const ast = parse(sourceCode, {
    sourceType: 'module',
    plugins: [
      isJSX ? 'jsx' : null,
      isTypeScript ? 'typescript' : null,
      'decorators-legacy',
      'classProperties',
      'optionalChaining',
      'nullishCoalescingOperator',
      'dynamicImport',
    ].filter(Boolean) as any[],
  });

  const result: AnalysisResult = {
    filePath,
    framework: 'unknown',
    isServerComponent: false,
    imports: [],
    routeParams: [...routeParams],
    queryParams: [],
    apiCalls: [],
    authDependencies: [],
    contextDependencies: [],
    hooks: [],
    componentProps: {},
    dataFetchingPattern: 'none',
    exportedComponent: undefined,
    isClientComponent: false,
    sourceCode,
  };

  // Check for 'use client' directive
  if (sourceCode.trimStart().startsWith("'use client'") || sourceCode.trimStart().startsWith('"use client"')) {
    result.isClientComponent = true;
  }

  // Detect framework from file path
  result.framework = detectFramework(filePath);
  result.isServerComponent = result.framework === 'nextjs-app' && !result.isClientComponent;

  traverse(ast, {
    // Collect imports
    ImportDeclaration(nodePath: NodePath<t.ImportDeclaration>) {
      const importInfo = extractImport(nodePath.node);
      result.imports.push(importInfo);
    },

    // Detect fetch/API calls
    CallExpression(nodePath: NodePath<t.CallExpression>) {
      const node = nodePath.node;

      // fetch() calls
      if (t.isIdentifier(node.callee, { name: 'fetch' })) {
        const apiCall = extractFetchCall(node);
        if (apiCall) result.apiCalls.push(apiCall);
      }

      // axios calls
      if (t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.object, { name: 'axios' })) {
        const apiCall = extractAxiosCall(node);
        if (apiCall) result.apiCalls.push(apiCall);
      }

      // Hook detection
      if (t.isIdentifier(node.callee) && node.callee.name.startsWith('use')) {
        const hookName = node.callee.name;
        const hookUsage: HookUsage = {
          name: hookName,
          args: extractCallArgs(node),
          line: node.loc?.start.line ?? 0,
        };
        result.hooks.push(hookUsage);

        // Auth hooks
        if (AUTH_HOOKS.has(hookName)) {
          const authDep = extractAuthDependency(nodePath, hookName);
          if (authDep) result.authDependencies.push(authDep);
        }

        // Data fetching hooks
        if (DATA_FETCHING_HOOKS.has(hookName)) {
          const apiCall = extractDataFetchingHookCall(node, hookName);
          if (apiCall) result.apiCalls.push(apiCall);
          result.dataFetchingPattern = 'client';
        }

        // Context hooks
        if (CONTEXT_HOOKS.has(hookName)) {
          const ctxDep = extractContextDependency(nodePath, hookName);
          if (ctxDep) result.contextDependencies.push(ctxDep);
        }

        // useSearchParams / useParams
        if (hookName === 'useSearchParams') {
          extractQueryParams(nodePath, result);
        }
        if (hookName === 'useParams') {
          extractParamsUsage(nodePath, result);
        }
      }

      // Server-side auth functions
      if (t.isIdentifier(node.callee) && AUTH_HOOKS.has(node.callee.name) && !node.callee.name.startsWith('use')) {
        result.authDependencies.push({
          type: 'session',
          source: node.callee.name,
          accessedProperties: [],
          line: node.loc?.start.line ?? 0,
        });
      }
    },

    // Detect getServerSideProps / getStaticProps
    ExportNamedDeclaration(nodePath: NodePath<t.ExportNamedDeclaration>) {
      const decl = nodePath.node.declaration;
      if (t.isFunctionDeclaration(decl)) {
        if (decl.id?.name === 'getServerSideProps') {
          result.dataFetchingPattern = 'ssr';
        } else if (decl.id?.name === 'getStaticProps') {
          result.dataFetchingPattern = 'ssg';
        }
      }
      if (t.isVariableDeclaration(decl)) {
        for (const declarator of decl.declarations) {
          if (t.isIdentifier(declarator.id)) {
            if (declarator.id.name === 'getServerSideProps') {
              result.dataFetchingPattern = 'ssr';
            } else if (declarator.id.name === 'getStaticProps') {
              result.dataFetchingPattern = 'ssg';
            } else if (declarator.id.name === 'revalidate') {
              result.dataFetchingPattern = 'isr';
            }
          }
        }
      }
    },

    // Detect default export (the page component)
    ExportDefaultDeclaration(nodePath: NodePath<t.ExportDefaultDeclaration>) {
      const decl = nodePath.node.declaration;
      if (t.isFunctionDeclaration(decl) && decl.id) {
        result.exportedComponent = decl.id.name;
        extractComponentProps(decl.params, result);
      } else if (t.isIdentifier(decl)) {
        result.exportedComponent = decl.name;
      } else if (t.isArrowFunctionExpression(decl) || t.isFunctionExpression(decl)) {
        result.exportedComponent = 'default';
        extractComponentProps(decl.params, result);
      }
    },

    // Detect async server component data fetching
    AwaitExpression(nodePath: NodePath<t.AwaitExpression>) {
      if (result.isServerComponent) {
        result.dataFetchingPattern = 'server-component';
      }
    },
  });

  // Post-processing: infer route param types from usage
  inferRouteParamTypes(result);

  return result;
}

function detectFramework(filePath: string): AnalysisResult['framework'] {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/app/') && (normalized.includes('/page.') || normalized.includes('/layout.'))) {
    return 'nextjs-app';
  }
  if (normalized.includes('/pages/')) {
    return 'nextjs-pages';
  }
  return 'react';
}

function extractImport(node: t.ImportDeclaration): ImportInfo {
  return {
    source: node.source.value,
    specifiers: node.specifiers.map(spec => {
      if (t.isImportDefaultSpecifier(spec)) {
        return { local: spec.local.name, imported: 'default', isDefault: true };
      }
      if (t.isImportSpecifier(spec)) {
        const imported = t.isIdentifier(spec.imported)
          ? spec.imported.name
          : spec.imported.value;
        return { local: spec.local.name, imported, isDefault: false };
      }
      // namespace import
      return { local: spec.local.name, imported: '*', isDefault: false };
    }),
    line: node.loc?.start.line ?? 0,
  };
}

function extractFetchCall(node: t.CallExpression): ApiCall | null {
  const firstArg = node.arguments[0];
  let endpoint = '/unknown';

  if (t.isStringLiteral(firstArg)) {
    endpoint = firstArg.value;
  } else if (t.isTemplateLiteral(firstArg)) {
    endpoint = templateLiteralToPattern(firstArg);
  }

  let method: ApiCall['method'] = 'GET';
  const secondArg = node.arguments[1];
  if (t.isObjectExpression(secondArg)) {
    const methodProp = secondArg.properties.find(
      p => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: 'method' })
    );
    if (methodProp && t.isObjectProperty(methodProp) && t.isStringLiteral(methodProp.value)) {
      method = methodProp.value.value.toUpperCase() as ApiCall['method'];
    }
  }

  return {
    endpoint,
    method,
    source: 'fetch',
    line: node.loc?.start.line ?? 0,
  };
}

function extractAxiosCall(node: t.CallExpression): ApiCall | null {
  const callee = node.callee as t.MemberExpression;
  const methodNode = callee.property;
  let method: ApiCall['method'] = 'unknown';

  if (t.isIdentifier(methodNode)) {
    method = methodNode.name.toUpperCase() as ApiCall['method'];
  }

  let endpoint = '/unknown';
  const firstArg = node.arguments[0];
  if (t.isStringLiteral(firstArg)) {
    endpoint = firstArg.value;
  } else if (t.isTemplateLiteral(firstArg)) {
    endpoint = templateLiteralToPattern(firstArg);
  }

  return {
    endpoint,
    method,
    source: 'axios',
    line: node.loc?.start.line ?? 0,
  };
}

function extractDataFetchingHookCall(node: t.CallExpression, hookName: string): ApiCall | null {
  let endpoint = '/unknown';
  let source: ApiCall['source'] = 'unknown';

  if (hookName === 'useSWR') {
    source = 'swr';
    const firstArg = node.arguments[0];
    if (t.isStringLiteral(firstArg)) {
      endpoint = firstArg.value;
    } else if (t.isTemplateLiteral(firstArg)) {
      endpoint = templateLiteralToPattern(firstArg);
    }
  } else if (hookName === 'useQuery' || hookName === 'useSuspenseQuery' || hookName === 'useInfiniteQuery') {
    source = 'react-query';
    const firstArg = node.arguments[0];
    if (t.isObjectExpression(firstArg)) {
      const queryKeyProp = firstArg.properties.find(
        p => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: 'queryKey' })
      );
      if (queryKeyProp && t.isObjectProperty(queryKeyProp) && t.isArrayExpression(queryKeyProp.value)) {
        const elements = queryKeyProp.value.elements;
        const parts = elements.map(el => {
          if (t.isStringLiteral(el)) return el.value;
          return '{param}';
        });
        endpoint = parts.join('/');
      }

      const queryFnProp = firstArg.properties.find(
        p => t.isObjectProperty(p) && t.isIdentifier(p.key, { name: 'queryFn' })
      );
      if (queryFnProp && t.isObjectProperty(queryFnProp)) {
        // Try to extract the fetch URL from queryFn
        if (t.isArrowFunctionExpression(queryFnProp.value) || t.isFunctionExpression(queryFnProp.value)) {
          const body = queryFnProp.value.body;
          if (t.isCallExpression(body) && t.isIdentifier(body.callee, { name: 'fetch' })) {
            const fetchCall = extractFetchCall(body);
            if (fetchCall) endpoint = fetchCall.endpoint;
          }
        }
      }
    }
  }

  return {
    endpoint,
    method: 'GET',
    source,
    line: node.loc?.start.line ?? 0,
  };
}

function extractAuthDependency(
  nodePath: NodePath<t.CallExpression>,
  hookName: string
): AuthDependency | null {
  const accessedProperties: string[] = [];

  // Try to find what properties are accessed from the result
  const parent = nodePath.parentPath;
  if (parent?.isVariableDeclarator()) {
    const id = parent.node.id;
    if (t.isObjectPattern(id)) {
      for (const prop of id.properties) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
          accessedProperties.push(prop.key.name);
        }
      }
    }
  }

  return {
    type: hookName.toLowerCase().includes('session') ? 'session' : 'hook',
    source: hookName,
    accessedProperties,
    line: nodePath.node.loc?.start.line ?? 0,
  };
}

function extractContextDependency(
  nodePath: NodePath<t.CallExpression>,
  hookName: string
): ContextDependency | null {
  const accessedProperties: string[] = [];
  let contextName = hookName;

  // For useContext, get the context name from the argument
  if (hookName === 'useContext') {
    const arg = nodePath.node.arguments[0];
    if (t.isIdentifier(arg)) {
      contextName = arg.name;
    }
  }

  // Find accessed properties
  const parent = nodePath.parentPath;
  if (parent?.isVariableDeclarator()) {
    const id = parent.node.id;
    if (t.isObjectPattern(id)) {
      for (const prop of id.properties) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
          accessedProperties.push(prop.key.name);
        }
      }
    }
  }

  return {
    name: contextName,
    hook: hookName,
    accessedProperties,
    line: nodePath.node.loc?.start.line ?? 0,
  };
}

function extractQueryParams(nodePath: NodePath<t.CallExpression>, result: AnalysisResult): void {
  // Look for .get() calls on the searchParams result
  const binding = nodePath.parentPath;
  if (binding?.isVariableDeclarator() && t.isIdentifier(binding.node.id)) {
    const varName = binding.node.id.name;
    const scope = binding.scope;
    const refs = scope.getBinding(varName)?.referencePaths ?? [];

    for (const ref of refs) {
      const memberParent = ref.parentPath;
      if (
        memberParent?.isMemberExpression() &&
        t.isIdentifier(memberParent.node.property, { name: 'get' })
      ) {
        const callParent = memberParent.parentPath;
        if (callParent?.isCallExpression()) {
          const arg = callParent.node.arguments[0];
          if (t.isStringLiteral(arg)) {
            result.queryParams.push({
              name: arg.value,
              inferredType: 'string',
              isOptional: true,
            });
          }
        }
      }
    }
  }
}

function extractParamsUsage(nodePath: NodePath<t.CallExpression>, result: AnalysisResult): void {
  const parent = nodePath.parentPath;
  if (parent?.isVariableDeclarator()) {
    const id = parent.node.id;
    if (t.isObjectPattern(id)) {
      for (const prop of id.properties) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
          const keyName = (prop.key as t.Identifier).name;
          const existing = result.routeParams.find(p => p.name === keyName);
          if (!existing) {
            result.routeParams.push({
              name: keyName,
              isDynamic: true,
              inferredType: 'string',
            });
          }
        }
      }
    }
  }
}

function extractComponentProps(
  params: (t.Identifier | t.Pattern | t.RestElement)[],
  result: AnalysisResult
): void {
  if (params.length === 0) return;
  const firstParam = params[0];

  if (t.isObjectPattern(firstParam)) {
    for (const prop of firstParam.properties) {
      if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
        let propType = 'unknown';
        const valueNode = prop.value;
        if (t.isIdentifier(valueNode) && valueNode.typeAnnotation && t.isTSTypeAnnotation(valueNode.typeAnnotation)) {
          propType = extractTSType(valueNode.typeAnnotation.typeAnnotation);
        }
        result.componentProps[(prop.key as t.Identifier).name] = propType;
      }
    }
  } else if (t.isIdentifier(firstParam) && firstParam.typeAnnotation) {
    if (t.isTSTypeAnnotation(firstParam.typeAnnotation)) {
      const annotation = firstParam.typeAnnotation.typeAnnotation;
      if (t.isTSTypeLiteral(annotation)) {
        for (const member of annotation.members) {
          if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
            const propType = member.typeAnnotation
              ? extractTSType(member.typeAnnotation.typeAnnotation)
              : 'unknown';
            result.componentProps[member.key.name] = propType;
          }
        }
      }
    }
  }
}

function extractTSType(node: t.TSType): string {
  if (t.isTSStringKeyword(node)) return 'string';
  if (t.isTSNumberKeyword(node)) return 'number';
  if (t.isTSBooleanKeyword(node)) return 'boolean';
  if (t.isTSArrayType(node)) return `${extractTSType(node.elementType)}[]`;
  if (t.isTSTypeReference(node) && t.isIdentifier(node.typeName)) {
    return node.typeName.name;
  }
  return 'unknown';
}

function extractCallArgs(node: t.CallExpression): string[] {
  return node.arguments.map(arg => {
    if (t.isStringLiteral(arg)) return arg.value;
    if (t.isNumericLiteral(arg)) return String(arg.value);
    if (t.isIdentifier(arg)) return arg.name;
    if (t.isTemplateLiteral(arg)) return templateLiteralToPattern(arg);
    return '<expr>';
  });
}

function templateLiteralToPattern(node: t.TemplateLiteral): string {
  let result = '';
  for (let i = 0; i < node.quasis.length; i++) {
    result += node.quasis[i].value.raw;
    if (i < node.expressions.length) {
      const expr = node.expressions[i];
      if (t.isIdentifier(expr)) {
        result += `{${expr.name}}`;
      } else if (t.isMemberExpression(expr) && t.isIdentifier(expr.property)) {
        result += `{${expr.property.name}}`;
      } else {
        result += '{param}';
      }
    }
  }
  return result;
}

function inferRouteParamTypes(result: AnalysisResult): void {
  // Look through API calls and hooks for usage patterns that suggest types
  for (const param of result.routeParams) {
    // If the param name suggests a number (id, count, etc.)
    if (/^(id|count|page|limit|offset|index|num)$/i.test(param.name)) {
      param.inferredType = 'number';
    }
  }
}
