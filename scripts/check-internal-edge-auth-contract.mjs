import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const typescript = require('typescript');
const root = resolve(process.cwd());
const functionsDirectory = join(root, 'supabase', 'functions');
const configPath = join(root, 'supabase', 'config.toml');
const denoConfigPath = join(root, 'deno.json');
const matrixPath = join(root, 'docs', 'operations', 'function-auth-matrix.md');
const runbookPath = join(root, 'docs', 'operations', 'runbooks.md');
const internalAuthPath = join(functionsDirectory, '_shared', 'internalAuth.ts');
const sentryPath = join(functionsDirectory, '_shared', 'sentry.ts');
const reviewedSentryModuleSpecifier = 'npm:@sentry/deno@10.58.0';
const reviewedSentryEnvironmentNames = new Set([
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'ENVIRONMENT',
  'SENTRY_RELEASE',
  'DEPLOY_GIT_SHA',
  'SENTRY_TRACES_SAMPLE_RATE',
]);
const reviewedSentryRuntimeBindingNames = new Set([
  'Deno',
  'Sentry',
  'globalThis',
  'Boolean',
  'Number',
  'Math',
  'Object',
  'Set',
  'Map',
  'TextEncoder',
  'Error',
  'fetch',
  'createClient',
  'supabase',
  'require',
  'eval',
  'Function',
  'Proxy',
  'Reflect',
  'WebAssembly',
  'process',
]);

const expectedFunctions = Object.freeze({
  'webhooks-rssapp': false,
  worker: false,
  'admin-retry': true,
  'db-cleanup': false,
  'media-processor': false,
  'media-cleanup': false,
  'admin-actions': true,
  'x-poster': false,
  'x-followers-snapshot': false,
  'digest-compiler': false,
});

const internalEntrypoints = Object.freeze({
  worker: {
    path: join(functionsDirectory, 'worker', 'index.ts'),
    request: 'req',
    serviceFactory: 'createClient',
    serveBinding: 'serve',
    serveModule: 'https://deno.land/std@0.168.0/http/server.ts',
    supabaseModule: 'https://esm.sh/@supabase/supabase-js@2.39.7',
    importModules: [
      'jsr:@supabase/functions-js/edge-runtime.d.ts',
      'https://deno.land/std@0.168.0/http/server.ts',
      'https://esm.sh/@supabase/supabase-js@2.39.7',
      '../_shared/openai.ts',
      '../_shared/observability.ts',
      '../_shared/translationReadability.ts',
      '../_shared/enrich.ts',
      '../_shared/scoring.ts',
      '../_shared/internalAuth.ts',
      '../_shared/sentry.ts',
      '../_shared/dedupe.ts',
      '../_shared/openaiCostControls.ts',
      '../_shared/duplicateGuard.ts',
      '../_shared/deliveryDedupeGuard.ts',
      '../_shared/scoringPolicy.ts',
      '../_shared/feedbackBias.ts',
      '../_shared/workerAutochain.ts',
      '../_shared/videoRenderGate.ts',
      '../_shared/mediaSelection.ts',
      '../_shared/staleMediaRepair.ts',
      './workerUtils.ts',
      './jobLifecycle.ts',
      './videoRenderWorkflow.ts',
      './telegramDelivery.ts',
      './telegramDeliveryClaim.ts',
      './xApiWorkflow.ts',
      './mediaWorkflow.ts',
      '../_shared/remoteMediaPolicy.ts',
      '../_shared/runtimeControls.ts',
      '../_shared/externalPostingGuard.ts',
      './scoringWorkflow.ts',
      './translateWorkflow.ts',
    ],
  },
  'db-cleanup': {
    path: join(functionsDirectory, 'db-cleanup', 'handler.ts'),
    request: 'request',
    serviceFactory: 'createSupabase',
  },
  'media-processor': {
    path: join(functionsDirectory, 'media-processor', 'handler.ts'),
    request: 'request',
    serviceFactory: 'createSupabase',
  },
  'media-cleanup': {
    path: join(functionsDirectory, 'media-cleanup', 'handler.ts'),
    request: 'request',
    serviceFactory: 'createSupabase',
  },
  'x-poster': {
    path: join(functionsDirectory, 'x-poster', 'index.ts'),
    request: 'req',
    serviceFactory: 'createClient',
    serveBinding: 'Deno.serve',
    serveModule: null,
    supabaseModule: 'https://esm.sh/@supabase/supabase-js@2.49.1',
    importModules: [
      'https://esm.sh/@supabase/supabase-js@2.49.1',
      '../_shared/internalAuth.ts',
      '../_shared/xApiLedger.ts',
      '../_shared/xPostText.ts',
      '../_shared/enrich.ts',
      '../_shared/duplicateGuard.ts',
      '../_shared/dedupe.ts',
      '../_shared/observability.ts',
      '../_shared/mediaSelection.ts',
      '../_shared/videoRenderGate.ts',
      '../_shared/videoRenderConfig.ts',
      '../_shared/sentry.ts',
      '../_shared/xPostDeliveryClaim.ts',
      '../_shared/staleMediaRepair.ts',
      '../_shared/xQuotaAdmission.ts',
      '../_shared/runtimeControls.ts',
      '../_shared/externalPostingGuard.ts',
    ],
  },
  'x-followers-snapshot': {
    path: join(functionsDirectory, 'x-followers-snapshot', 'index.ts'),
    request: 'req',
    serviceFactory: 'createClient',
    serveBinding: 'serve',
    serveModule: 'https://deno.land/std@0.168.0/http/server.ts',
    supabaseModule: 'https://esm.sh/@supabase/supabase-js@2.39.7',
    importModules: [
      'https://deno.land/std@0.168.0/http/server.ts',
      'https://esm.sh/@supabase/supabase-js@2.39.7',
      '../_shared/internalAuth.ts',
      '../_shared/xApiLedger.ts',
      '../_shared/myXControls.ts',
      '../_shared/sentry.ts',
    ],
  },
  'digest-compiler': {
    path: join(functionsDirectory, 'digest-compiler', 'index.ts'),
    request: 'req',
    serviceFactory: 'createClient',
    serveBinding: 'serve',
    serveModule: 'https://deno.land/std@0.168.0/http/server.ts',
    supabaseModule: 'https://esm.sh/@supabase/supabase-js@2.49.1',
    importModules: [
      'https://deno.land/std@0.168.0/http/server.ts',
      'https://esm.sh/@supabase/supabase-js@2.49.1',
      '../_shared/internalAuth.ts',
      '../_shared/openai.ts',
      '../_shared/observability.ts',
      '../_shared/sentry.ts',
    ],
  },
});

const internalWrappers = Object.freeze({
  'db-cleanup': {
    path: join(functionsDirectory, 'db-cleanup', 'index.ts'),
    handlerFactory: 'createDbCleanupHandler',
    handlerVariable: 'handler',
    dependencies: [
      'corsHeaders',
      'createSupabase',
      'requireInternalAuth',
      'serviceRoleBearerHeader',
      'getEnv',
      'captureException',
    ],
    dependencyBindings: {
      corsHeaders: { type: 'identifier', name: 'corsHeaders' },
      createSupabase: { type: 'serviceClientFactory' },
      requireInternalAuth: { type: 'identifier', name: 'requireInternalAuth' },
      serviceRoleBearerHeader: { type: 'identifier', name: 'serviceRoleBearerHeader' },
      getEnv: { type: 'envGetter' },
      captureException: { type: 'identifier', name: 'captureEdgeException' },
    },
    typeOnlyBindings: [],
    imports: [
      ['https://deno.land/std@0.168.0/http/server.ts', ['serve']],
      ['https://esm.sh/@supabase/supabase-js@2.39.7', ['createClient']],
      ['../_shared/internalAuth.ts', ['requireInternalAuth', 'serviceRoleBearerHeader']],
      ['../_shared/sentry.ts', ['captureEdgeException', 'initSentryEdge']],
      ['./handler.ts', ['createDbCleanupHandler']],
    ],
    handlerImports: [
      [
        '../_shared/cleanupSafety.ts',
        [
          'cleanupDisabledResponse',
          'DB_CLEANUP_MUTATIONS_ENABLED_ENV',
          'resolveCleanupExecutionMode',
        ],
      ],
    ],
    allowedTopLevelFunctions: ['checkedCleanupClient'],
  },
  'media-processor': {
    path: join(functionsDirectory, 'media-processor', 'index.ts'),
    handlerFactory: 'createMediaProcessorHandler',
    handlerVariable: 'handler',
    dependencies: [
      'corsHeaders',
      'createSupabase',
      'requireInternalAuth',
      'getEnv',
      'downloadMediaForTweet',
      'cleanupOldMedia',
      'getMediaInfo',
      'captureException',
    ],
    dependencyBindings: {
      corsHeaders: { type: 'identifier', name: 'corsHeaders' },
      createSupabase: { type: 'serviceClientFactory' },
      requireInternalAuth: { type: 'identifier', name: 'requireInternalAuth' },
      getEnv: { type: 'envGetter' },
      downloadMediaForTweet: { type: 'identifier', name: 'downloadMediaForTweet' },
      cleanupOldMedia: { type: 'cleanupAdapter' },
      getMediaInfo: { type: 'identifier', name: 'getMediaInfo' },
      captureException: { type: 'identifier', name: 'captureEdgeException' },
    },
    typeOnlyBindings: ['MediaDownloadEventMeta'],
    imports: [
      ['https://deno.land/std@0.168.0/http/server.ts', ['serve']],
      ['https://esm.sh/@supabase/supabase-js@2.39.7', ['createClient']],
      ['../_shared/internalAuth.ts', ['requireInternalAuth']],
      [
        '../_shared/safeMediaTelemetry.ts',
        [
          'MediaDownloadEventMeta',
          'safeMediaDownloadErrorCode',
          'safeMediaDownloadEventMeta',
          'safeMediaUrlHash',
          'safeMediaUrlTelemetry',
        ],
      ],
      [
        '../_shared/remoteMediaPolicy.ts',
        [
          'fetchReviewedRemoteMedia',
          'MAX_REMOTE_MEDIA_ITEMS_PER_POST',
          'validateReviewedRemoteMediaUrl',
        ],
      ],
      ['../_shared/sentry.ts', ['captureEdgeException', 'initSentryEdge']],
      ['./handler.ts', ['createMediaProcessorHandler']],
      ['./cleanupOldMedia.ts', ['cleanupOldMedia']],
    ],
    handlerImports: [
      [
        '../_shared/cleanupSafety.ts',
        [
          'cleanupDisabledResponse',
          'MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV',
          'resolveCleanupExecutionMode',
        ],
      ],
    ],
  },
  'media-cleanup': {
    path: join(functionsDirectory, 'media-cleanup', 'index.ts'),
    handlerFactory: 'createMediaCleanupHandler',
    handlerVariable: 'handler',
    dependencies: [
      'corsHeaders',
      'createSupabase',
      'requireInternalAuth',
      'serviceRoleBearerHeader',
      'getEnv',
      'captureException',
    ],
    dependencyBindings: {
      corsHeaders: { type: 'identifier', name: 'corsHeaders' },
      createSupabase: { type: 'serviceClientFactory' },
      requireInternalAuth: { type: 'identifier', name: 'requireInternalAuth' },
      serviceRoleBearerHeader: { type: 'identifier', name: 'serviceRoleBearerHeader' },
      getEnv: { type: 'envGetter' },
      captureException: { type: 'identifier', name: 'captureEdgeException' },
    },
    typeOnlyBindings: [],
    imports: [
      ['https://deno.land/std@0.168.0/http/server.ts', ['serve']],
      ['https://esm.sh/@supabase/supabase-js@2.39.7', ['createClient']],
      ['../_shared/internalAuth.ts', ['requireInternalAuth', 'serviceRoleBearerHeader']],
      ['../_shared/sentry.ts', ['captureEdgeException', 'initSentryEdge']],
      ['./handler.ts', ['createMediaCleanupHandler']],
    ],
    handlerImports: [
      [
        '../_shared/cleanupSafety.ts',
        [
          'cleanupDisabledResponse',
          'MEDIA_CLEANUP_MUTATIONS_ENABLED_ENV',
          'resolveCleanupExecutionMode',
        ],
      ],
    ],
    allowedTopLevelFunctions: ['isMediaCleanupResult', 'checkedMediaCleanupClient'],
  },
});

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message) {
  throw new Error(`INTERNAL_EDGE_AUTH_SOURCE_CONTRACT_FAIL ${message}`);
}

function functionConfigEntries(config) {
  const entries = new Map();
  const blockPattern = /^\[functions\.([^\]]+)\]\s*\n([\s\S]*?)(?=^\[functions\.|\s*$)/gm;
  for (const match of config.matchAll(blockPattern)) {
    const name = match[1];
    const verifyJwt = /^verify_jwt\s*=\s*(true|false)\s*$/m.exec(match[2])?.[1];
    if (!verifyJwt) fail(`${name} must declare verify_jwt explicitly`);
    entries.set(name, verifyJwt === 'true');
  }
  return entries;
}

function localFunctionNames() {
  return readdirSync(functionsDirectory)
    .filter((name) => name !== '_shared')
    .filter((name) => statSync(join(functionsDirectory, name)).isDirectory())
    .sort();
}

function resolveLocalModulePath(fromPath, specifier, sourceOverrides = new Map()) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromPath), specifier);
  const candidates = [base, `${base}.ts`, join(base, 'index.ts')];
  return candidates.find((candidate) => existsSync(candidate) || sourceOverrides.has(candidate)) ?? null;
}

function isRuntimeImport(statement) {
  const clause = statement.importClause;
  if (!clause) return true;
  if (!clause.isTypeOnly) return true;
  return false;
}

function isRuntimeModuleEdge(statement) {
  if (typescript.isImportDeclaration(statement)) return isRuntimeImport(statement);
  return typescript.isExportDeclaration(statement) && !statement.isTypeOnly;
}

const inertGlobalNames = new Set(['Object', 'Set', 'Map', 'TextEncoder', 'Error']);
const approvedGuardedRuntimeModuleSpecifiers = new Set([
  'npm:@sentry/deno@10.58.0',
]);

function isInertLiteral(node) {
  const value = unwrapExpression(node);
  return (
    typescript.isStringLiteral(value)
    || typescript.isNumericLiteral(value)
    || typescript.isBigIntLiteral(value)
    || typescript.isNoSubstitutionTemplateLiteral(value)
    || typescript.isRegularExpressionLiteral(value)
    || value.kind === typescript.SyntaxKind.TrueKeyword
    || value.kind === typescript.SyntaxKind.FalseKeyword
    || value.kind === typescript.SyntaxKind.NullKeyword
  );
}

function inertPrimitiveShape() {
  return { kind: 'primitive' };
}

function isPrimitiveShape(shape) {
  return shape?.kind === 'primitive';
}

function inertPropertyName(name) {
  if (
    typescript.isIdentifier(name)
    || typescript.isStringLiteral(name)
    || typescript.isNumericLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

function inertObjectLiteralShape(node, bindings) {
  const value = unwrapExpression(node);
  if (!typescript.isObjectLiteralExpression(value)) return null;
  const properties = new Map();
  for (const property of value.properties) {
    if (
      !typescript.isPropertyAssignment(property)
      || typescript.isComputedPropertyName(property.name)
    ) {
      return null;
    }
    const name = inertPropertyName(property.name);
    if (!name || name === '__proto__') return null;
    const shape = inertExpressionShape(property.initializer, bindings);
    if (!shape) return null;
    properties.set(name, shape);
  }
  return { kind: 'object', properties };
}

function inertCollectionShape(node, bindings) {
  const value = unwrapExpression(node);
  if (!typescript.isNewExpression(value) || !typescript.isIdentifier(value.expression)) return null;
  const argumentsList = value.arguments ?? [];
  if (value.expression.text === 'TextEncoder') {
    return argumentsList.length === 0 ? { kind: 'text-encoder' } : null;
  }
  if (!['Set', 'Map'].includes(value.expression.text) || argumentsList.length !== 1) {
    return null;
  }
  const argumentShape = inertExpressionShape(argumentsList[0], bindings);
  if (argumentShape?.kind !== 'array') return null;
  return { kind: value.expression.text === 'Set' ? 'set' : 'map' };
}

function inertObjectFreezeShape(node, bindings) {
  const value = unwrapExpression(node);
  if (
    !typescript.isCallExpression(value)
    || !typescript.isPropertyAccessExpression(value.expression)
    || value.expression.questionDotToken
    || !typescript.isIdentifier(value.expression.expression)
    || value.expression.expression.text !== 'Object'
    || value.expression.name.text !== 'freeze'
    || value.arguments.length !== 1
  ) {
    return null;
  }
  return inertObjectLiteralShape(value.arguments[0], bindings);
}

function inertExpressionShape(node, bindings) {
  const value = unwrapExpression(node);
  if (isInertLiteral(value)) {
    return typescript.isRegularExpressionLiteral(value)
      ? { kind: 'regexp' }
      : inertPrimitiveShape();
  }
  if (typescript.isIdentifier(value)) return bindings.get(value.text) ?? null;
  if (typescript.isArrayLiteralExpression(value)) {
    const elements = [];
    for (const element of value.elements) {
      if (typescript.isSpreadElement(element)) return null;
      const shape = inertExpressionShape(element, bindings);
      if (!shape) return null;
      elements.push(shape);
    }
    return { kind: 'array', elements };
  }
  if (typescript.isObjectLiteralExpression(value)) {
    return inertObjectLiteralShape(value, bindings);
  }
  if (typescript.isPropertyAccessExpression(value) && !value.questionDotToken) {
    const target = inertExpressionShape(value.expression, bindings);
    if (target?.kind !== 'object') return null;
    return target.properties.get(value.name.text) ?? null;
  }
  if (
    typescript.isPrefixUnaryExpression(value)
    && [
      typescript.SyntaxKind.PlusToken,
      typescript.SyntaxKind.MinusToken,
      typescript.SyntaxKind.ExclamationToken,
      typescript.SyntaxKind.TildeToken,
    ].includes(value.operator)
  ) {
    return isPrimitiveShape(inertExpressionShape(value.operand, bindings))
      ? inertPrimitiveShape()
      : null;
  }
  if (typescript.isBinaryExpression(value)) {
    if (
      [
        typescript.SyntaxKind.PlusToken,
        typescript.SyntaxKind.MinusToken,
        typescript.SyntaxKind.AsteriskToken,
        typescript.SyntaxKind.SlashToken,
        typescript.SyntaxKind.PercentToken,
        typescript.SyntaxKind.AsteriskAsteriskToken,
        typescript.SyntaxKind.LessThanLessThanToken,
        typescript.SyntaxKind.GreaterThanGreaterThanToken,
        typescript.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
        typescript.SyntaxKind.AmpersandToken,
        typescript.SyntaxKind.BarToken,
        typescript.SyntaxKind.CaretToken,
      ].includes(value.operatorToken.kind)
    ) {
      const left = inertExpressionShape(value.left, bindings);
      const right = inertExpressionShape(value.right, bindings);
      return isPrimitiveShape(left) && isPrimitiveShape(right)
        ? inertPrimitiveShape()
        : null;
    }
    return null;
  }
  return inertObjectFreezeShape(value, bindings) ?? inertCollectionShape(value, bindings);
}

function isInertExpression(node, bindings) {
  return Boolean(inertExpressionShape(node, bindings));
}

function containsDecorator(node) {
  let decorated = false;
  const visit = (current) => {
    if (current.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.Decorator)) {
      decorated = true;
      return;
    }
    typescript.forEachChild(current, visit);
  };
  visit(node);
  return decorated;
}

function isInertClassDeclaration(statement) {
  if (!typescript.isClassDeclaration(statement)) return false;
  if (statement.name && inertGlobalNames.has(statement.name.text)) return false;
  if (containsDecorator(statement)) return false;
  if (statement.heritageClauses?.length) {
    if (
      statement.heritageClauses.length !== 1
      || statement.heritageClauses[0].token !== typescript.SyntaxKind.ExtendsKeyword
      || statement.heritageClauses[0].types.length !== 1
      || !typescript.isIdentifier(statement.heritageClauses[0].types[0].expression)
      || statement.heritageClauses[0].types[0].expression.text !== 'Error'
    ) {
      return false;
    }
  }
  return statement.members.every((member) => {
    if (member.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.Decorator)) return false;
    if ('name' in member && member.name && typescript.isComputedPropertyName(member.name)) return false;
    if (hasModifier(member, typescript.SyntaxKind.StaticKeyword)) return false;
    if (member.kind === typescript.SyntaxKind.ClassStaticBlockDeclaration) return false;
    if (typescript.isPropertyDeclaration(member)) return !member.initializer;
    return (
      typescript.isConstructorDeclaration(member)
      || typescript.isMethodDeclaration(member)
      || typescript.isGetAccessorDeclaration(member)
      || typescript.isSetAccessorDeclaration(member)
      || typescript.isIndexSignatureDeclaration(member)
      || typescript.isSemicolonClassElement(member)
    );
  });
}

function moduleInitializationIssues(sourceFile, label) {
  const issues = [];
  const bindings = new Map();
  const importBindsTrustedGlobal = sourceFile.statements.some((statement) => {
    if (!typescript.isImportDeclaration(statement) || !statement.importClause) return false;
    const clause = statement.importClause;
    if (clause.name && inertGlobalNames.has(clause.name.text)) return true;
    const named = clause.namedBindings;
    if (named && typescript.isNamespaceImport(named) && inertGlobalNames.has(named.name.text)) return true;
    return Boolean(
      named
      && typescript.isNamedImports(named)
      && named.elements.some((specifier) => inertGlobalNames.has(specifier.name.text)),
    );
  });
  if (importBindsTrustedGlobal) {
    issues.push(`${label} may not shadow a trusted inert-initializer global`);
  }

  for (const statement of sourceFile.statements) {
    if (
      typescript.isImportDeclaration(statement)
      || typescript.isExportDeclaration(statement)
      || typescript.isTypeAliasDeclaration(statement)
      || typescript.isInterfaceDeclaration(statement)
    ) {
      continue;
    }
    if (typescript.isFunctionDeclaration(statement)) {
      if (statement.name && inertGlobalNames.has(statement.name.text)) {
        issues.push(`${label} may not shadow a trusted inert-initializer global`);
      }
      continue;
    }
    if (typescript.isClassDeclaration(statement)) {
      if (!isInertClassDeclaration(statement)) {
        issues.push(`${label} class declaration is not inert at module initialization`);
      }
      continue;
    }
    if (!typescript.isVariableStatement(statement)) {
      issues.push(`${label} may only declare inert const values during module initialization`);
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        !typescript.isIdentifier(declaration.name)
        || inertGlobalNames.has(declaration.name.text)
        || !declaration.initializer
      ) {
        issues.push(`${label} has a non-inert module initializer`);
        continue;
      }
      if (
        !isConstDeclaration(statement)
        && (
          !((statement.declarationList.flags & typescript.NodeFlags.Let) !== 0)
          || unwrapExpression(declaration.initializer).kind !== typescript.SyntaxKind.TrueKeyword
            && unwrapExpression(declaration.initializer).kind !== typescript.SyntaxKind.FalseKeyword
        )
      ) {
        issues.push(`${label} may only declare inert const values during module initialization`);
        continue;
      }
      if (!isConstDeclaration(statement)) continue;
      const shape = inertExpressionShape(declaration.initializer, bindings);
      if (
        !shape
      ) {
        issues.push(`${label} has a non-inert module initializer`);
        continue;
      }
      bindings.set(declaration.name.text, shape);
    }
  }
  return issues;
}

function guardedImportClosureIssues(sourceOverrides = new Map()) {
  const guardedRoots = [
    internalAuthPath,
    ...Object.values(internalEntrypoints).map((contract) => contract.path),
    ...Object.values(internalWrappers).map((contract) => contract.path),
  ];
  const approvedRuntimeClientModules = new Set([
    ...Object.values(internalEntrypoints)
      .filter((contract) => contract.supabaseModule)
      .map((contract) => contract.path),
    ...Object.values(internalWrappers).map((contract) => contract.path),
  ]);
  const queue = [...new Set(guardedRoots)];
  const visited = new Set();
  const issues = [];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (!filePath || visited.has(filePath)) continue;
    visited.add(filePath);
    const sourceFile = typescript.createSourceFile(
      filePath,
      sourceOverrides.get(filePath) ?? read(filePath),
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.TS,
    );
    if (sourceFile.parseDiagnostics.length > 0) {
      issues.push(`${filePath} must remain parseable in the guarded local import closure`);
      continue;
    }
    for (const statement of sourceFile.statements) {
      if (
        (!typescript.isImportDeclaration(statement) && !typescript.isExportDeclaration(statement))
        || !statement.moduleSpecifier
        || !typescript.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      const runtimeModuleEdge = isRuntimeModuleEdge(statement);
      const localImport = resolveLocalModulePath(filePath, specifier, sourceOverrides);
      if (localImport) queue.push(localImport);
      else if (specifier.startsWith('.')) {
        issues.push(`${filePath} has an unresolved local module edge in the guarded dependency closure`);
      }
      if (
        runtimeModuleEdge
        && !approvedRuntimeClientModules.has(filePath)
        && !specifier.startsWith('.')
        && !approvedGuardedRuntimeModuleSpecifiers.has(specifier)
      ) {
        issues.push(`${filePath} has an unapproved non-local runtime module edge in the guarded dependency closure: ${specifier}`);
      }
      if (
        specifier.includes('@supabase/supabase-js')
        && !approvedRuntimeClientModules.has(filePath)
        && runtimeModuleEdge
      ) {
        issues.push(`${filePath} may not import a runtime Supabase client inside the guarded dependency closure`);
      }
    }
    if (!approvedRuntimeClientModules.has(filePath)) {
      issues.push(...moduleInitializationIssues(sourceFile, filePath));
    }
  }
  return issues;
}

function requireBefore(source, earlier, later, label) {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);
  if (earlierIndex === -1 || laterIndex === -1 || earlierIndex >= laterIndex) {
    fail(`${label} must occur before privileged client construction`);
  }
}

function namedCallNodes(source, name) {
  const sourceFile = typescript.createSourceFile(
    `internal-edge-auth-${name}.ts`,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const calls = [];
  const visit = (node) => {
    if (
      typescript.isCallExpression(node)
      && typescript.isIdentifier(node.expression)
      && node.expression.text === name
    ) {
      calls.push({ node, sourceFile, index: node.getStart(sourceFile) });
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function propertyName(node) {
  if (!node) return null;
  if (typescript.isIdentifier(node) || typescript.isStringLiteral(node)) return node.text;
  return null;
}

function hasExactlyNames(actualNames, expectedNames) {
  const actual = [...actualNames].sort();
  const expected = [...expectedNames].sort();
  return (
    actual.length === expected.length
    && actual.every((name, index) => name === expected[index])
  );
}

function approvedWrapperImports(sourceFile, contract, issues) {
  const expectedByModule = new Map(contract.imports);
  const typeOnlyBindings = new Set(contract.typeOnlyBindings);
  const seenModules = new Map();
  const approvedImportSpecifiers = [];

  for (const statement of sourceFile.statements) {
    if (typescript.isExportDeclaration(statement) || typescript.isExportAssignment(statement)) {
      issues.push('wrapper may not re-export a module during initialization');
      continue;
    }
    if (!typescript.isImportDeclaration(statement)) continue;
    if (!typescript.isStringLiteral(statement.moduleSpecifier)) {
      issues.push('wrapper imports must use static string module specifiers');
      continue;
    }

    const moduleName = statement.moduleSpecifier.text;
    const expectedNames = expectedByModule.get(moduleName);
    if (!expectedNames) {
      issues.push(`wrapper imports unreviewed module ${moduleName}`);
      continue;
    }
    seenModules.set(moduleName, (seenModules.get(moduleName) ?? 0) + 1);

    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (
      !clause
      || clause.name
      || clause.isTypeOnly
      || !bindings
      || !typescript.isNamedImports(bindings)
    ) {
      issues.push(`wrapper import ${moduleName} must use direct named imports`);
      continue;
    }

    const actualNames = [];
    for (const specifier of bindings.elements) {
      if (specifier.propertyName) {
        issues.push(`wrapper import ${moduleName} may not alias ${specifier.name.text}`);
      }
      actualNames.push(specifier.name.text);
      if (Boolean(specifier.isTypeOnly) !== typeOnlyBindings.has(specifier.name.text)) {
        issues.push(`wrapper import ${moduleName} has an unexpected type-only binding ${specifier.name.text}`);
      }
      if (
        moduleName === 'https://esm.sh/@supabase/supabase-js@2.39.7'
        && specifier.name.text === 'createClient'
        && !specifier.propertyName
        && !specifier.isTypeOnly
      ) {
        approvedImportSpecifiers.push(specifier);
      }
    }
    if (!hasExactlyNames(actualNames, expectedNames)) {
      issues.push(`wrapper import ${moduleName} does not match its reviewed bindings`);
    }
  }

  for (const moduleName of expectedByModule.keys()) {
    if (seenModules.get(moduleName) !== 1) {
      issues.push(`wrapper must import ${moduleName} exactly once`);
    }
  }
  if (approvedImportSpecifiers.length !== 1) {
    issues.push('wrapper must import one runtime createClient binding from the canonical Supabase module');
  }
  return approvedImportSpecifiers;
}

function dependencyPropertyName(property) {
  if (
    !typescript.isPropertyAssignment(property)
    && !typescript.isShorthandPropertyAssignment(property)
  ) {
    return null;
  }
  if (typescript.isComputedPropertyName(property.name)) return null;
  return propertyName(property.name);
}

function dependencyValue(property) {
  if (typescript.isPropertyAssignment(property)) return property.initializer;
  if (typescript.isShorthandPropertyAssignment(property)) return property.name;
  return null;
}

function isDenoEnvRead(node, expectedArgument) {
  return (
    typescript.isCallExpression(node)
    && propertyAccessPath(node.expression) === 'Deno.env.get'
    && node.arguments.length === 1
    && expectedArgument(node.arguments[0])
  );
}

function isDenoEnvFallback(node, variableName, fallback = '') {
  return (
    typescript.isBinaryExpression(node)
    && node.operatorToken.kind === typescript.SyntaxKind.QuestionQuestionToken
    && isDenoEnvRead(
      node.left,
      (argument) => typescript.isStringLiteral(argument) && argument.text === variableName,
    )
    && typescript.isStringLiteral(node.right)
    && node.right.text === fallback
  );
}

function hasMatchingParameterPassThrough(value, expectedCallee, trailingArgument) {
  if (!typescript.isArrowFunction(value) || !typescript.isCallExpression(value.body)) return false;
  if (!typescript.isIdentifier(value.body.expression) || value.body.expression.text !== expectedCallee) return false;
  if (value.parameters.some((parameter) => !typescript.isIdentifier(parameter.name))) return false;
  if (value.body.arguments.length !== value.parameters.length + 1) return false;
  const parametersMatch = value.parameters.every(
    (parameter, index) => (
      typescript.isIdentifier(value.body.arguments[index])
      && value.body.arguments[index].text === parameter.name.text
    ),
  );
  const trailing = value.body.arguments[value.body.arguments.length - 1];
  return (
    parametersMatch
    && typescript.isIdentifier(trailing)
    && trailing.text === trailingArgument
  );
}

function matchesDependencyBinding(property, binding) {
  const value = dependencyValue(property);
  if (!value) return false;

  if (binding.type === 'identifier') {
    return typescript.isIdentifier(value) && value.text === binding.name;
  }
  if (binding.type === 'serviceClientFactory') {
    return (
      typescript.isPropertyAssignment(property)
      && typescript.isArrowFunction(value)
      && value.parameters.length === 0
      && typescript.isCallExpression(value.body)
      && typescript.isIdentifier(value.body.expression)
      && value.body.expression.text === 'createClient'
      && value.body.arguments.length === 2
      && isDenoEnvFallback(value.body.arguments[0], 'SUPABASE_URL')
      && isDenoEnvFallback(value.body.arguments[1], 'SUPABASE_SERVICE_ROLE_KEY')
    );
  }
  if (binding.type === 'envGetter') {
    return (
      typescript.isPropertyAssignment(property)
      && typescript.isArrowFunction(value)
      && value.parameters.length === 1
      && typescript.isIdentifier(value.parameters[0].name)
      && isDenoEnvRead(
        value.body,
        (argument) => (
          typescript.isIdentifier(argument)
          && argument.text === value.parameters[0].name.text
        ),
      )
    );
  }
  if (binding.type === 'cleanupAdapter') {
    return (
      (typescript.isIdentifier(value) && value.text === 'cleanupOldMedia')
      || hasMatchingParameterPassThrough(value, 'cleanupOldMedia', 'corsHeaders')
      || (
        typescript.isArrowFunction(value)
        && value.parameters.length === 3
        && typescript.isCallExpression(value.body)
        && typescript.isIdentifier(value.body.expression)
        && value.body.expression.text === 'cleanupOldMedia'
        && value.body.arguments.length === 4
        && typescript.isCallExpression(value.body.arguments[0])
        && typescript.isIdentifier(value.body.arguments[0].expression)
        && value.body.arguments[0].expression.text === 'requireMediaCleanupSupabaseClient'
        && value.body.arguments.slice(1, 3).every((argument, index) =>
          typescript.isIdentifier(argument)
          && typescript.isIdentifier(value.parameters[index + 1].name)
          && argument.text === value.parameters[index + 1].name.text)
        && typescript.isIdentifier(value.body.arguments[3])
        && value.body.arguments[3].text === 'corsHeaders'
      )
    );
  }
  return false;
}

function findApprovedWrapperFactoryCall(sourceFile, contract, issues) {
  const { handlerFactory, handlerVariable, dependencies } = contract;
  const handlerCalls = [];
  const visit = (node) => {
    if (
      typescript.isCallExpression(node)
      && typescript.isIdentifier(node.expression)
      && node.expression.text === handlerFactory
    ) {
      handlerCalls.push(node);
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (handlerCalls.length !== 1) {
    issues.push(`${handlerFactory} must be called exactly once with its dependency object`);
    return null;
  }

  const [handlerCall] = handlerCalls;
  const declaration = handlerCall.parent;
  if (
    !typescript.isVariableDeclaration(declaration)
    || declaration.initializer !== handlerCall
    || !typescript.isIdentifier(declaration.name)
    || declaration.name.text !== handlerVariable
    || !typescript.isVariableDeclarationList(declaration.parent)
    || (declaration.parent.flags & typescript.NodeFlags.Const) === 0
    || !typescript.isVariableStatement(declaration.parent.parent)
    || declaration.parent.parent.parent !== sourceFile
  ) {
    issues.push(`${handlerFactory} must initialize const ${handlerVariable}`);
    return null;
  }
  if (handlerCall.arguments.length !== 1 || !typescript.isObjectLiteralExpression(handlerCall.arguments[0])) {
    issues.push(`${handlerFactory} must receive one inline dependency object`);
    return null;
  }

  const properties = handlerCall.arguments[0].properties;
  const propertyNames = properties.map(dependencyPropertyName);
  if (
    propertyNames.some((name) => name === null)
    || !hasExactlyNames(propertyNames, dependencies)
    || !hasExactlyNames(Object.keys(contract.dependencyBindings), dependencies)
  ) {
    issues.push(`${handlerFactory} dependency object must match the reviewed exact shape`);
    return null;
  }

  for (const property of properties) {
    const name = dependencyPropertyName(property);
    const binding = name ? contract.dependencyBindings[name] : null;
    if (!binding || !matchesDependencyBinding(property, binding)) {
      issues.push(`${handlerFactory} dependency ${name ?? '<unknown>'} must retain its reviewed binding`);
      return null;
    }
  }

  const factoryProperty = properties.find(
    (property) => dependencyPropertyName(property) === 'createSupabase',
  );
  const factory = factoryProperty && dependencyValue(factoryProperty);
  if (!factory || !typescript.isArrowFunction(factory) || !typescript.isCallExpression(factory.body)) {
    issues.push('createSupabase must remain an approved service-client factory');
    return null;
  }
  return { createClientCall: factory.body, handlerCall, handlerDeclaration: declaration };
}

function propertyAccessPath(node) {
  if (!typescript.isPropertyAccessExpression(node)) return null;
  const parts = [node.name.text];
  let cursor = node.expression;
  while (typescript.isPropertyAccessExpression(cursor)) {
    parts.unshift(cursor.name.text);
    cursor = cursor.expression;
  }
  if (!typescript.isIdentifier(cursor)) return null;
  parts.unshift(cursor.text);
  return parts.join('.');
}

function isNamedCall(node, name) {
  return (
    typescript.isCallExpression(node)
    && typescript.isIdentifier(node.expression)
    && node.expression.text === name
  );
}

function topLevelVariableDeclarations(sourceFile, name) {
  const declarations = [];
  for (const statement of sourceFile.statements) {
    if (!typescript.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (typescript.isIdentifier(declaration.name) && declaration.name.text === name) {
        declarations.push(declaration);
      }
    }
  }
  return declarations;
}

function findRegisteredServeCall(sourceFile, handlerDeclaration, issues) {
  const handlerVariable = (
    handlerDeclaration && typescript.isIdentifier(handlerDeclaration.name)
      ? handlerDeclaration.name.text
      : null
  );
  if (!handlerVariable) {
    issues.push('wrapper must define the reviewed handler before registering serve');
    return null;
  }
  const serveCalls = [];
  const visit = (node) => {
    if (isNamedCall(node, 'serve')) serveCalls.push(node);
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (serveCalls.length !== 1) {
    issues.push('wrapper must register exactly one serve(handler) call');
    return null;
  }
  const [serveCall] = serveCalls;
  if (
    serveCall.arguments.length !== 1
    || !typescript.isIdentifier(serveCall.arguments[0])
    || serveCall.arguments[0].text !== handlerVariable
    || !typescript.isExpressionStatement(serveCall.parent)
    || serveCall.parent.parent !== sourceFile
    || topLevelVariableDeclarations(sourceFile, handlerVariable).length !== 1
    || topLevelVariableDeclarations(sourceFile, handlerVariable)[0] !== handlerDeclaration
  ) {
    issues.push(`wrapper must register const ${handlerVariable} directly with serve`);
    return null;
  }
  return serveCall;
}

function isExactInitSentryCall(node) {
  return isNamedCall(node, 'initSentryEdge') && node.arguments.length === 0;
}

function validateCorsHeadersDeclaration(declaration, sourceFile, issues) {
  if (
    !typescript.isVariableDeclarationList(declaration.parent)
    || (declaration.parent.flags & typescript.NodeFlags.Const) === 0
    || !typescript.isVariableStatement(declaration.parent.parent)
    || declaration.parent.parent.parent !== sourceFile
    || !typescript.isObjectLiteralExpression(declaration.initializer)
  ) {
    issues.push('corsHeaders must remain a top-level const object literal');
    return;
  }

  const properties = declaration.initializer.properties;
  const names = properties.map(dependencyPropertyName);
  if (
    names.some((name) => name === null)
    || !hasExactlyNames(names, ['Access-Control-Allow-Origin', 'Access-Control-Allow-Headers'])
  ) {
    issues.push('corsHeaders must retain its reviewed two-header shape');
    return;
  }

  const origin = properties.find(
    (property) => dependencyPropertyName(property) === 'Access-Control-Allow-Origin',
  );
  const allowedHeaders = properties.find(
    (property) => dependencyPropertyName(property) === 'Access-Control-Allow-Headers',
  );
  const originValue = origin && dependencyValue(origin);
  const headersValue = allowedHeaders && dependencyValue(allowedHeaders);
  if (
    !originValue
    || !isDenoEnvFallback(
      originValue,
      'ALLOWED_CORS_ORIGIN',
      'https://liquid-feed-flux.lovable.app',
    )
    || !headersValue
    || !typescript.isStringLiteral(headersValue)
    || !headersValue.text.includes('authorization')
    || !headersValue.text.includes('x-internal-token')
  ) {
    issues.push('corsHeaders must retain its reviewed origin and internal-auth header policy');
  }
}

function wrapperTopLevelStatementIssues(
  sourceFile,
  handlerDeclaration,
  registeredServeCall,
  issues,
) {
  let corsHeadersDeclarations = 0;
  let initSentryCalls = 0;

  for (const statement of sourceFile.statements) {
    if (typescript.isImportDeclaration(statement)) continue;
    if (typescript.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.length !== 1) {
        issues.push('wrapper module initialization may not combine declarations');
        continue;
      }
      const [declaration] = statement.declarationList.declarations;
      if (typescript.isIdentifier(declaration.name) && declaration.name.text === 'corsHeaders') {
        corsHeadersDeclarations += 1;
        validateCorsHeadersDeclaration(declaration, sourceFile, issues);
      } else if (declaration !== handlerDeclaration) {
        issues.push('wrapper module initialization may only declare corsHeaders and the reviewed handler');
      }
      continue;
    }
    if (typescript.isExpressionStatement(statement)) {
      if (isExactInitSentryCall(statement.expression)) {
        initSentryCalls += 1;
      } else if (statement.expression !== registeredServeCall) {
        issues.push('wrapper module initialization may only initialize Sentry and serve the reviewed handler');
      }
      continue;
    }
    if (
      typescript.isFunctionDeclaration(statement)
      || typescript.isTypeAliasDeclaration(statement)
      || typescript.isInterfaceDeclaration(statement)
    ) {
      if (
        typescript.isFunctionDeclaration(statement)
        && statement.name
        && statement.name.text === 'Deno'
      ) {
        issues.push('wrapper may not shadow the Deno runtime binding');
      }
      continue;
    }
    issues.push('wrapper contains an unreviewed top-level statement');
  }

  if (corsHeadersDeclarations !== 1) {
    issues.push('wrapper must declare exactly one reviewed corsHeaders object');
  }
  if (initSentryCalls !== 1) {
    issues.push('wrapper must initialize Sentry exactly once at module load');
  }
}

function wrapperCreateClientIssues(source, contract) {
  const sourceFile = typescript.createSourceFile(
    'internal-edge-auth-wrapper.ts',
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const issues = [];
  const approvedImportSpecifiers = approvedWrapperImports(sourceFile, contract, issues);
  const approvedFactory = findApprovedWrapperFactoryCall(sourceFile, contract, issues);
  const registeredServeCall = findRegisteredServeCall(
    sourceFile,
    approvedFactory?.handlerDeclaration,
    issues,
  );
  wrapperTopLevelStatementIssues(
    sourceFile,
    approvedFactory?.handlerDeclaration,
    registeredServeCall,
    issues,
  );
  const visit = (node) => {
    if (typescript.isIdentifier(node) && node.text === 'createClient') {
      const parent = node.parent;
      const isApprovedImport = approvedImportSpecifiers.includes(parent);
      const isApprovedFactoryCall = (
        approvedFactory
        && parent === approvedFactory.createClientCall
        && approvedFactory.createClientCall.expression === node
      );
      if (!isApprovedImport && !isApprovedFactoryCall) {
        issues.push('createClient may only be referenced by the lazy createSupabase factory');
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

function exactNamedImportIssues(sourceFile, imports, typeOnlyBindings, label) {
  const expectedByModule = new Map(imports);
  const allowedTypeOnly = new Set(typeOnlyBindings);
  const seenModules = new Map();
  const issues = [];

  for (const statement of sourceFile.statements) {
    if (!typescript.isImportDeclaration(statement)) continue;
    if (!typescript.isStringLiteral(statement.moduleSpecifier)) {
      issues.push(`${label} imports must use static string module specifiers`);
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    const expectedNames = expectedByModule.get(moduleName);
    if (!expectedNames) {
      issues.push(`${label} imports unreviewed module ${moduleName}`);
      continue;
    }
    seenModules.set(moduleName, (seenModules.get(moduleName) ?? 0) + 1);

    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (
      !clause
      || clause.name
      || clause.isTypeOnly
      || !bindings
      || !typescript.isNamedImports(bindings)
    ) {
      issues.push(`${label} import ${moduleName} must use direct named imports`);
      continue;
    }
    const actualNames = [];
    for (const specifier of bindings.elements) {
      actualNames.push(specifier.name.text);
      if (specifier.propertyName) {
        issues.push(`${label} import ${moduleName} may not alias ${specifier.name.text}`);
      }
      if (Boolean(specifier.isTypeOnly) !== allowedTypeOnly.has(specifier.name.text)) {
        issues.push(`${label} import ${moduleName} has unexpected type-only binding ${specifier.name.text}`);
      }
    }
    if (!hasExactlyNames(actualNames, expectedNames)) {
      issues.push(`${label} import ${moduleName} does not match reviewed bindings`);
    }
  }

  for (const moduleName of expectedByModule.keys()) {
    if (seenModules.get(moduleName) !== 1) {
      issues.push(`${label} must import ${moduleName} exactly once`);
    }
  }
  return issues;
}

function handlerModuleIssues(source, contract) {
  const sourceFile = typescript.createSourceFile(
    `internal-edge-handler-${contract.handlerFactory}.ts`,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const issues = exactNamedImportIssues(
    sourceFile,
    contract.handlerImports,
    [],
    `${contract.handlerFactory} handler module`,
  );

  for (const statement of sourceFile.statements) {
    if (typescript.isImportDeclaration(statement)) continue;
    if (
      typescript.isFunctionDeclaration(statement)
      || typescript.isTypeAliasDeclaration(statement)
      || typescript.isInterfaceDeclaration(statement)
    ) {
      continue;
    }
    issues.push(`${contract.handlerFactory} handler module contains unreviewed initialization`);
  }

  const visit = (node) => {
    if (typescript.isIdentifier(node) && node.text === 'createClient') {
      issues.push(`${contract.handlerFactory} handler module may not construct a client directly`);
    }
    if (typescript.isElementAccessExpression(node)) {
      issues.push(`${contract.handlerFactory} handler module may not use element access`);
    }
    if (
      typescript.isCallExpression(node)
      && node.expression.kind === typescript.SyntaxKind.ImportKeyword
    ) {
      issues.push(`${contract.handlerFactory} handler module may not dynamically import a client factory`);
    }
    if (typescript.isIdentifier(node) && ['Reflect', 'eval', 'Function', 'require'].includes(node.text)) {
      issues.push(`${contract.handlerFactory} handler module may not use reflective client construction`);
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, issues };
}

function authDeclarationFromStatement(statement, requestName) {
  if (!typescript.isVariableStatement(statement)) return null;
  for (const declaration of statement.declarationList.declarations) {
    const initializer = declaration.initializer;
    if (
      !typescript.isIdentifier(declaration.name)
      || !initializer
      || !typescript.isAwaitExpression(initializer)
      || !typescript.isCallExpression(initializer.expression)
      || !typescript.isIdentifier(initializer.expression.expression)
      || initializer.expression.expression.text !== 'requireInternalAuth'
      || initializer.expression.arguments.length !== 2
      || !typescript.isIdentifier(initializer.expression.arguments[0])
      || initializer.expression.arguments[0].text !== requestName
      || !typescript.isIdentifier(initializer.expression.arguments[1])
      || initializer.expression.arguments[1].text !== 'corsHeaders'
    ) {
      continue;
    }
    return {
      declaration,
      authName: declaration.name.text,
      authCall: initializer.expression,
    };
  }
  return null;
}

function isAuthReturnGuard(statement, authName) {
  return (
    typescript.isIfStatement(statement)
    && !statement.elseStatement
    && typescript.isIdentifier(statement.expression)
    && statement.expression.text === authName
    && typescript.isReturnStatement(statement.thenStatement)
    && typescript.isIdentifier(statement.thenStatement.expression)
    && statement.thenStatement.expression.text === authName
  );
}

function serviceFactoryFromStatement(statement, factoryName) {
  if (!typescript.isVariableStatement(statement)) return null;
  for (const declaration of statement.declarationList.declarations) {
    const initializer = declaration.initializer;
    if (
      !typescript.isIdentifier(declaration.name)
      || !initializer
      || !typescript.isCallExpression(initializer)
      || !typescript.isIdentifier(initializer.expression)
      || initializer.expression.text !== factoryName
    ) {
      continue;
    }
    return { declaration, serviceCall: initializer };
  }
  return null;
}

function findAuthBoundaryInBlock(block, requestName, factoryName) {
  const statements = block.statements;
  for (let index = 0; index + 2 < statements.length; index += 1) {
    const auth = authDeclarationFromStatement(statements[index], requestName);
    if (!auth || !isAuthReturnGuard(statements[index + 1], auth.authName)) continue;
    for (let serviceIndex = index + 2; serviceIndex < statements.length; serviceIndex += 1) {
      const service = serviceFactoryFromStatement(statements[serviceIndex], factoryName);
      if (service) return {
        block,
        auth,
        service,
        authIndex: index,
        serviceIndex,
      };
    }
  }
  return null;
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function isConstDeclaration(statement) {
  return (
    typescript.isVariableStatement(statement)
    && (statement.declarationList.flags & typescript.NodeFlags.Const) !== 0
  );
}

function isSingleIdentifierDeclaration(statement, name, valueMatches) {
  if (!isConstDeclaration(statement) || statement.declarationList.declarations.length !== 1) return false;
  const [declaration] = statement.declarationList.declarations;
  return (
    typescript.isIdentifier(declaration.name)
    && declaration.name.text === name
    && Boolean(declaration.initializer)
    && valueMatches(declaration.initializer)
  );
}

function unwrapExpression(node) {
  let value = node;
  while (
    typescript.isParenthesizedExpression(value)
    || typescript.isAsExpression(value)
    || typescript.isTypeAssertionExpression(value)
    || typescript.isNonNullExpression(value)
  ) {
    value = value.expression;
  }
  return value;
}

function isExactIdentifier(node, name) {
  return typescript.isIdentifier(node) && node.text === name;
}

function isRequestHeaderRead(node, header) {
  return (
    typescript.isCallExpression(node)
    && propertyAccessPath(node.expression) === 'req.headers.get'
    && node.arguments.length === 1
    && typescript.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === header
  );
}

function isOrEmptyString(node, leftMatches) {
  const value = unwrapExpression(node);
  return (
    typescript.isBinaryExpression(value)
    && value.operatorToken.kind === typescript.SyntaxKind.BarBarToken
    && leftMatches(unwrapExpression(value.left))
    && typescript.isStringLiteral(unwrapExpression(value.right))
    && unwrapExpression(value.right).text === ''
  );
}

function isTrimmedHeaderRead(node, header) {
  const value = unwrapExpression(node);
  return (
    typescript.isCallExpression(value)
    && value.arguments.length === 0
    && typescript.isPropertyAccessExpression(value.expression)
    && value.expression.name.text === 'trim'
    && isOrEmptyString(value.expression.expression, (candidate) => isRequestHeaderRead(candidate, header))
  );
}

function isOptionsProperty(node, property) {
  return propertyAccessPath(node) === `options.${property}`;
}

function isTypeofOptionsPropertyString(node, property) {
  return (
    typescript.isBinaryExpression(node)
    && node.operatorToken.kind === typescript.SyntaxKind.EqualsEqualsEqualsToken
    && typescript.isTypeOfExpression(node.left)
    && isOptionsProperty(node.left.expression, property)
    && typescript.isStringLiteral(node.right)
    && node.right.text === 'string'
  );
}

function isNamedNoArgumentCall(node, path) {
  return (
    typescript.isCallExpression(node)
    && propertyAccessPath(node.expression) === path
    && node.arguments.length === 0
  );
}

function isNamedOneStringArgumentCall(node, name, argument) {
  return (
    typescript.isCallExpression(node)
    && typescript.isIdentifier(node.expression)
    && node.expression.text === name
    && node.arguments.length === 1
    && typescript.isStringLiteral(node.arguments[0])
    && node.arguments[0].text === argument
  );
}

function isExactSecretResolution(node, property, envName, trim) {
  const value = unwrapExpression(node);
  return (
    typescript.isConditionalExpression(value)
    && isTypeofOptionsPropertyString(value.condition, property)
    && (
      trim
        ? isNamedNoArgumentCall(value.whenTrue, `options.${property}.trim`)
        : isOptionsProperty(value.whenTrue, property)
    )
    && isNamedOneStringArgumentCall(value.whenFalse, 'readOptionalEnv', envName)
  );
}

function isDirectReturn(statement, expressionMatches) {
  return (
    typescript.isReturnStatement(statement)
    && Boolean(statement.expression)
    && expressionMatches(statement.expression)
  );
}

function isRequestOptionsPreflight(statement, requestName) {
  if (
    !typescript.isIfStatement(statement)
    || statement.elseStatement
    || !typescript.isBinaryExpression(statement.expression)
    || statement.expression.operatorToken.kind !== typescript.SyntaxKind.EqualsEqualsEqualsToken
    || propertyAccessPath(statement.expression.left) !== `${requestName}.method`
    || !typescript.isStringLiteral(statement.expression.right)
    || statement.expression.right.text !== 'OPTIONS'
  ) {
    return false;
  }
  if (typescript.isReturnStatement(statement.thenStatement)) return true;
  return (
    typescript.isBlock(statement.thenStatement)
    && statement.thenStatement.statements.length === 1
    && typescript.isReturnStatement(statement.thenStatement.statements[0])
  );
}

function boundaryPrefixIssues(boundary, requestName, label) {
  if (boundary.authIndex === 0) return [];
  if (
    boundary.authIndex === 1
    && isRequestOptionsPreflight(boundary.block.statements[0], requestName)
  ) {
    return [];
  }
  return [`${label} may only handle OPTIONS before fail-closed internal auth`];
}

function directEntrypointImportIssues(sourceFile, contract, label) {
  const issues = [];
  const actualModules = [];
  const authImports = [];
  const clientImports = [];
  const serverImports = [];

  for (const statement of sourceFile.statements) {
    if (typescript.isExportDeclaration(statement) || typescript.isExportAssignment(statement)) {
      issues.push(`${label} may not re-export or alias its request handler dependencies`);
      continue;
    }
    if (!typescript.isImportDeclaration(statement)) continue;
    if (!typescript.isStringLiteral(statement.moduleSpecifier)) {
      issues.push(`${label} imports must use static string module specifiers`);
      continue;
    }
    const moduleName = statement.moduleSpecifier.text;
    actualModules.push(moduleName);
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;

    if (moduleName === '../_shared/internalAuth.ts') {
      if (!clause || clause.isTypeOnly || !bindings || !typescript.isNamedImports(bindings)) {
        issues.push(`${label} must import requireInternalAuth directly from the reviewed helper`);
      } else {
        for (const specifier of bindings.elements) {
          if (specifier.name.text !== 'requireInternalAuth') continue;
          authImports.push(specifier);
          if (specifier.isTypeOnly || specifier.propertyName) {
            issues.push(`${label} may not alias or type-only import requireInternalAuth`);
          }
        }
      }
    }

    if (moduleName.includes('@supabase/supabase-js')) {
      if (moduleName !== contract.supabaseModule) {
        issues.push(`${label} imports an unreviewed Supabase client module`);
      }
      if (
        !clause
        || clause.isTypeOnly
        || clause.name
        || !bindings
        || !typescript.isNamedImports(bindings)
        || bindings.elements.length !== 1
      ) {
        issues.push(`${label} must import only the reviewed runtime createClient binding`);
      } else {
        const [specifier] = bindings.elements;
        clientImports.push(specifier);
        if (
          specifier.isTypeOnly
          || specifier.propertyName
          || specifier.name.text !== 'createClient'
        ) {
          issues.push(`${label} may not alias, namespace, or type-only import createClient`);
        }
      }
    }

    if (contract.serveModule && moduleName === contract.serveModule) {
      if (
        !clause
        || clause.isTypeOnly
        || clause.name
        || !bindings
        || !typescript.isNamedImports(bindings)
        || bindings.elements.length !== 1
      ) {
        issues.push(`${label} must import only the reviewed runtime serve binding`);
      } else {
        const [specifier] = bindings.elements;
        serverImports.push(specifier);
        if (
          specifier.isTypeOnly
          || specifier.propertyName
          || specifier.name.text !== 'serve'
        ) {
          issues.push(`${label} may not alias, namespace, or type-only import serve`);
        }
      }
    }
  }

  if (!hasExactlyNames(actualModules, contract.importModules)) {
    issues.push(`${label} import module inventory changed without review`);
  }
  if (authImports.length !== 1) {
    issues.push(`${label} must have exactly one reviewed runtime requireInternalAuth import`);
  }
  if (clientImports.length !== 1) {
    issues.push(`${label} must have exactly one reviewed runtime createClient import`);
  }
  if (contract.serveModule && serverImports.length !== 1) {
    issues.push(`${label} must have exactly one reviewed runtime serve import`);
  }
  return {
    issues,
    authImport: authImports.length === 1 ? authImports[0] : null,
    clientImport: clientImports.length === 1 ? clientImports[0] : null,
    serverImport: serverImports.length === 1 ? serverImports[0] : null,
  };
}

function isDirectServeExpression(node, contract) {
  if (contract.serveBinding === 'serve') {
    return typescript.isIdentifier(node) && node.text === 'serve';
  }
  return contract.serveBinding === 'Deno.serve' && propertyAccessPath(node) === 'Deno.serve';
}

function directServeHandler(sourceFile, contract, label) {
  const handlers = [];
  for (const statement of sourceFile.statements) {
    if (!typescript.isExpressionStatement(statement) || !typescript.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (!isDirectServeExpression(call.expression, contract)) continue;
    handlers.push(call);
  }
  if (handlers.length !== 1) {
    return { issue: `${label} must register exactly one direct serve callback`, handler: null };
  }
  const [call] = handlers;
  const handler = call.arguments[0];
  if (
    call.arguments.length !== 1
    || (!typescript.isArrowFunction(handler) && !typescript.isFunctionExpression(handler))
    || !handler.body
    || !typescript.isBlock(handler.body)
    || handler.parameters.length !== 1
    || !typescript.isIdentifier(handler.parameters[0].name)
    || handler.parameters[0].name.text !== contract.request
  ) {
    return { issue: `${label} must register one reviewed async request callback`, handler: null };
  }
  return { issue: null, handler, call };
}

function directRuntimeImportBindings(statement) {
  if (!typescript.isImportDeclaration(statement) || !isRuntimeImport(statement)) return [];
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return [];
  const bindings = [];
  if (clause.name) bindings.push({ name: clause.name, specifier: null });
  const named = clause.namedBindings;
  if (named && typescript.isNamespaceImport(named)) {
    bindings.push({ name: named.name, specifier: named });
  } else if (named && typescript.isNamedImports(named)) {
    for (const specifier of named.elements) {
      if (!specifier.isTypeOnly) bindings.push({ name: specifier.name, specifier });
    }
  }
  return bindings;
}

function isExactReviewedInitSentryBinding(statement, binding) {
  return (
    typescript.isImportDeclaration(statement)
    && typescript.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === '../_shared/sentry.ts'
    && binding.specifier
    && typescript.isImportSpecifier(binding.specifier)
    && !binding.specifier.isTypeOnly
    && !binding.specifier.propertyName
    && binding.specifier.name.text === 'initSentryEdge'
  );
}

function directTopLevelStatementIssues(sourceFile, servedCall, imports, label) {
  const issues = [];
  const bindings = new Map();
  let corsHeadersDeclarations = 0;
  let initSentryCalls = 0;
  let initSentryImports = 0;

  for (const statement of sourceFile.statements) {
    if (typescript.isImportDeclaration(statement)) {
      for (const binding of directRuntimeImportBindings(statement)) {
        const name = binding.name.text;
        if (inertGlobalNames.has(name) || ['Deno', 'globalThis'].includes(name)) {
          issues.push(`${label} may not shadow an inert or runtime global through an import`);
        }
        if (
          name === 'serve'
          && (!imports.serverImport || binding.name !== imports.serverImport.name)
        ) {
          issues.push(`${label} may not shadow the reviewed serve binding through an import`);
        }
        if (name === 'initSentryEdge') {
          initSentryImports += 1;
          if (!isExactReviewedInitSentryBinding(statement, binding)) {
            issues.push(`${label} must import initSentryEdge directly from the reviewed Sentry module`);
          }
        }
      }
      continue;
    }
    if (typescript.isTypeAliasDeclaration(statement) || typescript.isInterfaceDeclaration(statement)) {
      continue;
    }
    if (typescript.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.length !== 1) {
        issues.push(`${label} may not combine direct-entrypoint module-initialization declarations`);
        continue;
      }
      const [declaration] = statement.declarationList.declarations;
      if (
        !typescript.isIdentifier(declaration.name)
        || inertGlobalNames.has(declaration.name.text)
        || ['Deno', 'globalThis', 'serve', 'initSentryEdge'].includes(declaration.name.text)
        || !declaration.initializer
      ) {
        issues.push(`${label} has an unreviewed direct-entrypoint module initializer`);
        continue;
      }
      if (declaration.name.text === 'corsHeaders') {
        corsHeadersDeclarations += 1;
        validateCorsHeadersDeclaration(declaration, sourceFile, issues);
        continue;
      }
      if (isConstDeclaration(statement)) {
        const shape = inertExpressionShape(declaration.initializer, bindings);
        if (!shape) {
          issues.push(`${label} may only declare reviewed inert const values at module initialization`);
          continue;
        }
        bindings.set(declaration.name.text, shape);
        continue;
      }
      if (
        (statement.declarationList.flags & typescript.NodeFlags.Let) !== 0
        && unwrapExpression(declaration.initializer).kind === typescript.SyntaxKind.NullKeyword
      ) {
        continue;
      }
      issues.push(`${label} may only declare reviewed inert const values or null module state`);
      continue;
    }
    if (typescript.isExpressionStatement(statement)) {
      if (statement.expression === servedCall) continue;
      if (isExactInitSentryCall(statement.expression)) {
        initSentryCalls += 1;
        continue;
      }
      issues.push(`${label} may only initialize Sentry and register its reviewed serve callback at module initialization`);
      continue;
    }
    if (typescript.isFunctionDeclaration(statement)) {
      if (
        statement.name
        && (inertGlobalNames.has(statement.name.text)
          || ['Deno', 'globalThis', 'serve', 'initSentryEdge'].includes(statement.name.text))
      ) {
        issues.push(`${label} may not shadow a reviewed direct-entrypoint runtime binding`);
      }
      continue;
    }
    if (typescript.isClassDeclaration(statement)) {
      if (!isInertClassDeclaration(statement)) {
        issues.push(`${label} has a non-inert direct-entrypoint class declaration`);
      }
      continue;
    }
    issues.push(`${label} contains an unreviewed top-level statement`);
  }

  if (corsHeadersDeclarations !== 1) {
    issues.push(`${label} must retain exactly one reviewed corsHeaders declaration`);
  }
  if (initSentryCalls !== 1) {
    issues.push(`${label} must initialize Sentry exactly once at module load`);
  }
  if (initSentryImports !== 1) {
    issues.push(`${label} must retain exactly one reviewed runtime initSentryEdge import`);
  }
  return issues;
}

function servedAuthBlock(handler, requestName, label) {
  const statements = handler.body.statements;
  let index = 0;
  if (statements.length > 0 && isRequestOptionsPreflight(statements[0], requestName)) {
    index = 1;
  }
  if (statements[index] && typescript.isTryStatement(statements[index])) {
    if (index + 1 !== statements.length) {
      return { issue: `${label} may not run statements beside its reviewed auth try block`, block: null };
    }
    return { issue: null, block: statements[index].tryBlock, tryStatement: statements[index] };
  }
  return { issue: null, block: handler.body, tryStatement: null };
}

function isApprovedDirectEnvValue(node, envName) {
  const value = unwrapExpression(node);
  return (
    isDenoEnvRead(value, (argument) => typescript.isStringLiteral(argument) && argument.text === envName)
    || isDenoEnvFallback(value, envName)
  );
}

function isApprovedDirectEnvArgument(node, boundary, envName) {
  if (isApprovedDirectEnvValue(node, envName)) return true;
  if (!typescript.isIdentifier(node)) return false;

  const declarations = [];
  for (let index = 0; index < boundary.serviceIndex; index += 1) {
    const statement = boundary.block.statements[index];
    if (!isConstDeclaration(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (typescript.isIdentifier(declaration.name) && declaration.name.text === node.text) {
        declarations.push(declaration);
      }
    }
  }
  return (
    declarations.length === 1
    && Boolean(declarations[0].initializer)
    && isApprovedDirectEnvValue(declarations[0].initializer, envName)
  );
}

function directClientCallIssues(boundary, label) {
  const call = boundary.service.serviceCall;
  if (call.arguments.length !== 2) {
    return [`${label} service client must receive exactly the reviewed URL and service-role key`];
  }
  const expected = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  return expected.flatMap((envName, index) => (
    isApprovedDirectEnvArgument(call.arguments[index], boundary, envName)
      ? []
      : [`${label} service client ${envName} argument must remain the reviewed environment value`]
  ));
}

function memberCapabilityName(node) {
  if (typescript.isPropertyAccessExpression(node)) return node.name.text;
  if (typescript.isElementAccessExpression(node) && node.argumentExpression) {
    return propertyName(node.argumentExpression);
  }
  return null;
}

function directCapabilityReferenceIssues(sourceFile, boundary, imports, label) {
  const issues = [];
  const isApprovedAuthIdentifier = (node) => (
    (imports.authImport && node === imports.authImport.name)
    || (node === boundary.auth.authCall.expression)
  );
  const isApprovedClientIdentifier = (node) => (
    (imports.clientImport && node === imports.clientImport.name)
    || (node === boundary.service.serviceCall.expression)
  );
  const visit = (node) => {
    if (typescript.isIdentifier(node) && node.text === 'requireInternalAuth' && !isApprovedAuthIdentifier(node)) {
      issues.push(`${label} may not alias or bypass its reviewed requireInternalAuth import`);
    }
    if (typescript.isIdentifier(node) && node.text === 'createClient' && !isApprovedClientIdentifier(node)) {
      issues.push(`${label} may not alias or invoke createClient outside the served post-auth boundary`);
    }
    if (
      (typescript.isPropertyAccessExpression(node) || typescript.isElementAccessExpression(node))
      && ['requireInternalAuth', 'createClient'].includes(memberCapabilityName(node))
    ) {
      issues.push(`${label} may not use computed or namespace auth/client capabilities`);
    }
    if (typescript.isCallExpression(node) && node.expression.kind === typescript.SyntaxKind.ImportKeyword) {
      issues.push(`${label} may not dynamically import an auth or service-client capability`);
    }
    if (
      typescript.isCallExpression(node)
      && (
        (typescript.isIdentifier(node.expression) && ['eval', 'Function', 'require'].includes(node.expression.text))
        || propertyAccessPath(node.expression)?.startsWith('Reflect.')
      )
    ) {
      issues.push(`${label} may not reflectively construct an auth or service client`);
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

function isBindingDeclarationIdentifier(node) {
  const parent = node.parent;
  return (
    (typescript.isVariableDeclaration(parent) && parent.name === node)
    || (typescript.isBindingElement(parent) && parent.name === node)
    || (typescript.isParameter(parent) && parent.name === node)
    || (typescript.isFunctionDeclaration(parent) && parent.name === node)
    || (typescript.isClassDeclaration(parent) && parent.name === node)
    || (typescript.isImportSpecifier(parent) && parent.name === node)
    || (typescript.isNamespaceImport(parent) && parent.name === node)
    || (typescript.isImportClause(parent) && parent.name === node)
    || (typescript.isCatchClause(parent) && parent.variableDeclaration?.name === node)
  );
}

function isRuntimeBindingDeclarationIdentifier(node) {
  const parent = node.parent;
  if (!parent) return false;
  return (
    (typescript.isVariableDeclaration(parent) && parent.name === node)
    || (typescript.isBindingElement(parent) && parent.name === node)
    || (typescript.isParameter(parent) && parent.name === node)
    || (typescript.isFunctionDeclaration(parent) && parent.name === node)
    || (typescript.isFunctionExpression(parent) && parent.name === node)
    || (typescript.isClassDeclaration(parent) && parent.name === node)
    || (typescript.isClassExpression(parent) && parent.name === node)
    || (typescript.isEnumDeclaration(parent) && parent.name === node)
    || (typescript.isModuleDeclaration(parent) && parent.name === node)
    || (typescript.isImportClause(parent) && parent.name === node)
    || (typescript.isImportSpecifier(parent) && parent.name === node)
    || (typescript.isNamespaceImport(parent) && parent.name === node)
  );
}

function isGlobalThisReference(node) {
  const value = unwrapExpression(node);
  return typescript.isIdentifier(value) && value.text === 'globalThis';
}

function staticMemberPath(node) {
  const parts = [];
  let cursor = unwrapExpression(node);
  while (
    typescript.isPropertyAccessExpression(cursor)
    || typescript.isElementAccessExpression(cursor)
  ) {
    if (typescript.isPropertyAccessExpression(cursor)) {
      if (cursor.questionDotToken) return null;
      parts.unshift(cursor.name.text);
    } else {
      const argument = cursor.argumentExpression && unwrapExpression(cursor.argumentExpression);
      if (!argument || !typescript.isStringLiteral(argument)) return null;
      parts.unshift(argument.text);
    }
    cursor = unwrapExpression(cursor.expression);
  }
  if (!typescript.isIdentifier(cursor)) return null;
  parts.unshift(cursor.text);
  return parts.join('.');
}

function isDenoRuntimeBindingTarget(node) {
  const value = unwrapExpression(node);
  if (typescript.isIdentifier(value) && value.text === 'Deno') return true;
  const path = staticMemberPath(value);
  if (path === 'globalThis.Deno' || path?.startsWith('globalThis.Deno.')) return true;
  if (typescript.isPropertyAccessExpression(value) && !value.questionDotToken) {
    return isDenoRuntimeBindingTarget(value.expression);
  }
  if (typescript.isElementAccessExpression(value)) {
    return isDenoRuntimeBindingTarget(value.expression);
  }
  if (
    typescript.isCallExpression(value)
    && ['Object.getPrototypeOf', 'Reflect.getPrototypeOf'].includes(staticMemberPath(value.expression))
    && value.arguments.length === 1
  ) {
    return isDenoRuntimeBindingTarget(value.arguments[0]);
  }
  return false;
}

function isDenoRuntimeMutationCall(node) {
  const value = unwrapExpression(node);
  if (!typescript.isCallExpression(value)) return false;
  const path = staticMemberPath(value.expression);
  if (![
    'Object.defineProperty',
    'Reflect.defineProperty',
    'Reflect.set',
    'Object.defineProperties',
    'Object.assign',
    'Object.setPrototypeOf',
    'Reflect.setPrototypeOf',
    'Reflect.deleteProperty',
  ].includes(path)) {
    return false;
  }
  const target = value.arguments[0];
  if (!target || (!isGlobalThisReference(target) && !isDenoRuntimeBindingTarget(target))) {
    return false;
  }
  if (
    isDenoRuntimeBindingTarget(target)
    || ['Object.defineProperties', 'Object.assign', 'Object.setPrototypeOf', 'Reflect.setPrototypeOf'].includes(path)
  ) {
    return true;
  }
  const key = value.arguments[1];
  return Boolean(
    key
    && typescript.isStringLiteral(unwrapExpression(key))
    && unwrapExpression(key).text === 'Deno',
  );
}

function isDenoRuntimeWrite(node) {
  if (!typescript.isBinaryExpression(node) || !isDenoRuntimeBindingTarget(node.left)) {
    return false;
  }
  return [
    typescript.SyntaxKind.EqualsToken,
    typescript.SyntaxKind.PlusEqualsToken,
    typescript.SyntaxKind.MinusEqualsToken,
    typescript.SyntaxKind.AsteriskEqualsToken,
    typescript.SyntaxKind.AsteriskAsteriskEqualsToken,
    typescript.SyntaxKind.SlashEqualsToken,
    typescript.SyntaxKind.PercentEqualsToken,
    typescript.SyntaxKind.LessThanLessThanEqualsToken,
    typescript.SyntaxKind.GreaterThanGreaterThanEqualsToken,
    typescript.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
    typescript.SyntaxKind.AmpersandEqualsToken,
    typescript.SyntaxKind.BarEqualsToken,
    typescript.SyntaxKind.CaretEqualsToken,
    typescript.SyntaxKind.AmpersandAmpersandEqualsToken,
    typescript.SyntaxKind.BarBarEqualsToken,
    typescript.SyntaxKind.QuestionQuestionEqualsToken,
  ].includes(node.operatorToken.kind);
}

function isDenoRuntimeUnaryWrite(node) {
  const isIncrementOrDecrement = (
    node.operator === typescript.SyntaxKind.PlusPlusToken
    || node.operator === typescript.SyntaxKind.MinusMinusToken
  );
  return (
    isIncrementOrDecrement
    && (typescript.isPrefixUnaryExpression(node) || typescript.isPostfixUnaryExpression(node))
    && isDenoRuntimeBindingTarget(node.operand)
  );
}

function isDenoRuntimeDelete(node) {
  return (
    node.kind === typescript.SyntaxKind.DeleteExpression
    && isDenoRuntimeBindingTarget(node.expression)
  );
}

function directServerBindingIssues(sourceFile, served, imports, contract, label) {
  const issues = [];
  const visit = (node) => {
    if (contract.serveBinding === 'serve' && typescript.isIdentifier(node) && node.text === 'serve') {
      const approved = (
        (imports.serverImport && node === imports.serverImport.name)
        || node === served.call.expression
      );
      if (!approved) {
        issues.push(`${label} may not shadow or replace its reviewed runtime serve binding`);
      }
    }
    if (contract.serveBinding === 'Deno.serve') {
      if (
        typescript.isIdentifier(node)
        && node.text === 'Deno'
        && isRuntimeBindingDeclarationIdentifier(node)
      ) {
        issues.push(`${label} may not shadow the Deno runtime binding`);
      }
      if (isDenoRuntimeWrite(node) || isDenoRuntimeUnaryWrite(node) || isDenoRuntimeDelete(node)) {
        issues.push(`${label} may not replace or mutate the Deno runtime binding`);
      }
      if (isDenoRuntimeMutationCall(node)) {
        issues.push(`${label} may not mutate the Deno runtime binding`);
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

function isServiceCredentialRead(node) {
  return isDenoEnvRead(
    node,
    (argument) => (
      typescript.isStringLiteral(argument)
      && ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(argument.text)
    ),
  );
}

function isDescendantOf(node, ancestor) {
  let cursor = node;
  while (cursor) {
    if (cursor === ancestor) return true;
    cursor = cursor.parent;
  }
  return false;
}

function isPostAuthBoundaryNode(node, boundary) {
  if (!isDescendantOf(node, boundary.block)) return false;
  for (let index = 0; index < boundary.block.statements.length; index += 1) {
    if (isDescendantOf(node, boundary.block.statements[index])) {
      return index >= boundary.authIndex + 2;
    }
  }
  return false;
}

function servedCallbackPrivilegeIssues(handler, boundary, label) {
  const issues = [];
  const visit = (node) => {
    if (node !== handler && typescript.isFunctionLike(node)) return;
    if (isServiceCredentialRead(node) && !isPostAuthBoundaryNode(node, boundary)) {
      issues.push(`${label} may not read a service credential outside its reviewed post-auth boundary`);
    }
    typescript.forEachChild(node, visit);
  };
  visit(handler.body);
  return issues;
}

function isRawFetchCall(node) {
  return (
    typescript.isCallExpression(node)
    && (
      (typescript.isIdentifier(node.expression) && node.expression.text === 'fetch')
      || propertyAccessPath(node.expression) === 'globalThis.fetch'
    )
  );
}

function servedTryErrorPathIssues(tryStatement, label) {
  const issues = [];
  if (tryStatement.finallyBlock) {
    issues.push(`${label} may not execute a finally block around pre-auth handling`);
  }
  if (!tryStatement.catchClause) return issues;
  const visit = (node) => {
    if (node !== tryStatement.catchClause && typescript.isFunctionLike(node)) return;
    if (isServiceCredentialRead(node) || isRawFetchCall(node)) {
      issues.push(`${label} catch path may not read service credentials or issue raw fetch requests`);
    }
    typescript.forEachChild(node, visit);
  };
  visit(tryStatement.catchClause);
  return issues;
}

function directEntrypointIssues(source, contract, label) {
  const sourceFile = typescript.createSourceFile(
    `internal-edge-entrypoint-${label}.ts`,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const issues = [];
  if (sourceFile.parseDiagnostics.length > 0) {
    issues.push(`${label} must remain parseable`);
    return issues;
  }
  const imports = directEntrypointImportIssues(sourceFile, contract, label);
  issues.push(...imports.issues);
  const served = directServeHandler(sourceFile, contract, label);
  if (served.issue || !served.handler) {
    issues.push(served.issue ?? `${label} must register a served request callback`);
    return issues;
  }
  issues.push(...directTopLevelStatementIssues(sourceFile, served.call, imports, label));
  const servedBlock = servedAuthBlock(served.handler, contract.request, label);
  if (servedBlock.issue || !servedBlock.block) {
    issues.push(servedBlock.issue ?? `${label} must contain a reviewed auth block`);
    return issues;
  }
  const boundary = findAuthBoundaryInBlock(servedBlock.block, contract.request, contract.serviceFactory);
  if (!boundary) {
    issues.push(`${label} must await internal auth, return its rejection, then construct its service client inside the served callback`);
    return issues;
  }
  issues.push(...boundaryPrefixIssues(boundary, contract.request, label));
  issues.push(...directClientCallIssues(boundary, label));
  issues.push(...directCapabilityReferenceIssues(sourceFile, boundary, imports, label));
  issues.push(...directServerBindingIssues(sourceFile, served, imports, contract, label));
  issues.push(...servedCallbackPrivilegeIssues(served.handler, boundary, label));
  if (servedBlock.tryStatement) {
    issues.push(...servedTryErrorPathIssues(servedBlock.tryStatement, label));
  }
  return issues;
}

function isExactHandlerDestructure(statement, dependencies) {
  if (!isConstDeclaration(statement) || statement.declarationList.declarations.length !== 1) return false;
  const [declaration] = statement.declarationList.declarations;
  if (
    !typescript.isObjectBindingPattern(declaration.name)
    || !typescript.isIdentifier(declaration.initializer)
    || declaration.initializer.text !== 'dependencies'
  ) {
    return false;
  }
  const names = [];
  for (const element of declaration.name.elements) {
    if (
      element.dotDotDotToken
      || element.propertyName
      || element.initializer
      || !typescript.isIdentifier(element.name)
    ) {
      return false;
    }
    names.push(element.name.text);
  }
  return hasExactlyNames(names, dependencies);
}

function handlerFactoryStructureIssues(source, contract, label) {
  const sourceFile = typescript.createSourceFile(
    `internal-edge-handler-${label}.ts`,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const issues = [];
  if (sourceFile.parseDiagnostics.length > 0) {
    issues.push(`${label} handler module must remain parseable`);
    return issues;
  }
  const factories = sourceFile.statements.filter(
    (statement) => typescript.isFunctionDeclaration(statement) && statement.name?.text === contract.handlerFactory,
  );
  if (factories.length !== 1) {
    issues.push(`${label} handler module must declare exactly one ${contract.handlerFactory} factory`);
    return issues;
  }
  const [factory] = factories;
  const allowedTopLevelFunctions = new Set(contract.allowedTopLevelFunctions ?? []);
  const topLevelFunctionCapabilityNames = new Set([
    'Deno',
    'globalThis',
    'fetch',
    'requireInternalAuth',
    'createSupabase',
    'serviceRoleBearerHeader',
    'captureException',
    'eval',
    'Function',
    'require',
  ]);
  for (const statement of sourceFile.statements) {
    if (
      typescript.isImportDeclaration(statement)
      || typescript.isTypeAliasDeclaration(statement)
      || statement === factory
      || (
        typescript.isFunctionDeclaration(statement)
        && statement.name
        && allowedTopLevelFunctions.has(statement.name.text)
      )
    ) {
      if (
        typescript.isFunctionDeclaration(statement)
        && statement.name
        && allowedTopLevelFunctions.has(statement.name.text)
      ) {
        const visitTopLevelHelper = (node) => {
          if (typescript.isIdentifier(node) && topLevelFunctionCapabilityNames.has(node.text)) {
            issues.push(`${label} allowed top-level helper may not reference privileged capability ${node.text}`);
          }
          if (typescript.isCallExpression(node) && node.expression.kind === typescript.SyntaxKind.ImportKeyword) {
            issues.push(`${label} allowed top-level helper may not dynamically import capabilities`);
          }
          typescript.forEachChild(node, visitTopLevelHelper);
        };
        if (statement.body) visitTopLevelHelper(statement.body);
      }
      continue;
    }
    issues.push(`${label} handler module may not run unreviewed top-level code`);
  }
  if (
    !hasModifier(factory, typescript.SyntaxKind.ExportKeyword)
    || factory.parameters.length !== 1
    || !typescript.isIdentifier(factory.parameters[0].name)
    || factory.parameters[0].name.text !== 'dependencies'
    || !factory.body
    || factory.body.statements.length !== 2
    || !isExactHandlerDestructure(factory.body.statements[0], contract.dependencies)
    || !typescript.isReturnStatement(factory.body.statements[1])
    || !factory.body.statements[1].expression
    || !typescript.isArrowFunction(factory.body.statements[1].expression)
  ) {
    issues.push(`${label} handler factory must retain its reviewed dependency destructure and one returned request callback`);
    return issues;
  }
  const callback = factory.body.statements[1].expression;
  if (
    !hasModifier(callback, typescript.SyntaxKind.AsyncKeyword)
    || callback.parameters.length !== 1
    || !typescript.isIdentifier(callback.parameters[0].name)
    || callback.parameters[0].name.text !== contract.request
    || !typescript.isBlock(callback.body)
  ) {
    issues.push(`${label} handler factory must return the reviewed async request callback`);
    return issues;
  }
  const boundary = findAuthBoundaryInBlock(callback.body, contract.request, contract.serviceFactory);
  if (!boundary) {
    issues.push(`${label} handler must authenticate and reject inside its returned callback before creating a service client`);
    return issues;
  }
  issues.push(...boundaryPrefixIssues(boundary, contract.request, label));
  if (boundary.service.serviceCall.arguments.length !== 0) {
    issues.push(`${label} handler may only call the reviewed zero-argument injected service factory`);
  }
  const destructure = factory.body.statements[0].declarationList.declarations[0].name;
  const allowedBindings = new Set(destructure.elements.map((element) => element.name));
  const visit = (node) => {
    if (typescript.isIdentifier(node) && ['requireInternalAuth', contract.serviceFactory].includes(node.text)) {
      const isApproved = (
        allowedBindings.has(node)
        || (node === boundary.auth.authCall.expression)
        || (node === boundary.service.serviceCall.expression)
        || (typescript.isPropertySignature(node.parent) && node.parent.name === node)
      );
      if (!isApproved) {
        issues.push(`${label} handler may not alias or invoke ${node.text} outside its reviewed callback boundary`);
      }
    }
    if (
      (typescript.isPropertyAccessExpression(node) || typescript.isElementAccessExpression(node))
      && ['requireInternalAuth', contract.serviceFactory].includes(memberCapabilityName(node))
    ) {
      issues.push(`${label} handler may not extract auth or service capabilities by member access`);
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}

function isTimingSafeCall(node, leftName, rightName, templatePrefix = null) {
  if (
    !typescript.isCallExpression(node)
    || !typescript.isIdentifier(node.expression)
    || node.expression.text !== 'timingSafeStringEqual'
    || node.arguments.length !== 2
    || !typescript.isIdentifier(node.arguments[0])
    || node.arguments[0].text !== leftName
  ) {
    return false;
  }
  if (!templatePrefix) {
    return typescript.isIdentifier(node.arguments[1]) && node.arguments[1].text === rightName;
  }
  const template = node.arguments[1];
  return (
    typescript.isTemplateExpression(template)
    && template.head.text === templatePrefix
    && template.templateSpans.length === 1
    && typescript.isIdentifier(template.templateSpans[0].expression)
    && template.templateSpans[0].expression.text === rightName
  );
}

function topLevelFunctionsByName(sourceFile, name) {
  return sourceFile.statements.filter(
    (statement) => typescript.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
}

function isExactCredentialGuard(statement, guardName, leftName, rightName, templatePrefix = null) {
  return (
    typescript.isIfStatement(statement)
    && !statement.elseStatement
    && typescript.isBinaryExpression(statement.expression)
    && statement.expression.operatorToken.kind === typescript.SyntaxKind.AmpersandAmpersandToken
    && isExactIdentifier(statement.expression.left, guardName)
    && isTimingSafeCall(statement.expression.right, leftName, rightName, templatePrefix)
    && isDirectReturn(statement.thenStatement, (expression) => expression.kind === typescript.SyntaxKind.NullKeyword)
  );
}

function isUnauthorizedResponseReturn(statement) {
  if (!typescript.isReturnStatement(statement) || !statement.expression) return false;
  const expression = statement.expression;
  if (
    !typescript.isNewExpression(expression)
    || !typescript.isIdentifier(expression.expression)
    || expression.expression.text !== 'Response'
    || expression.arguments?.length !== 2
    || !typescript.isObjectLiteralExpression(expression.arguments[1])
  ) {
    return false;
  }
  return expression.arguments[1].properties.some(
    (property) => (
      typescript.isPropertyAssignment(property)
      && propertyName(property.name) === 'status'
      && typescript.isNumericLiteral(property.initializer)
      && property.initializer.text === '401'
    ),
  );
}

function internalAuthModuleStructureIssues(sourceFile) {
  const issues = [];
  const imports = sourceFile.statements.filter((statement) => typescript.isImportDeclaration(statement));
  if (imports.length !== 1) {
    issues.push('internal auth helper may only import the reviewed RSS payload policy module');
  } else {
    const [statement] = imports;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    const names = bindings && typescript.isNamedImports(bindings)
      ? bindings.elements.map((specifier) => specifier.name.text)
      : [];
    if (
      !typescript.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== './rssWebhookPayloadPolicy.ts'
      || !clause
      || clause.isTypeOnly
      || clause.name
      || !bindings
      || !typescript.isNamedImports(bindings)
      || bindings.elements.some((specifier) => specifier.isTypeOnly || specifier.propertyName)
      || !hasExactlyNames(names, ['buildRssWebhookSignatureInput', 'readBoundedRssWebhookBody'])
    ) {
      issues.push('internal auth helper import contract changed without review');
    }
  }
  for (const statement of sourceFile.statements) {
    if (
      typescript.isImportDeclaration(statement)
      || typescript.isTypeAliasDeclaration(statement)
      || typescript.isFunctionDeclaration(statement)
    ) {
      continue;
    }
    issues.push('internal auth helper may not execute top-level initialization code');
  }
  return issues;
}

function isExactPropertyRead(node, path) {
  return propertyAccessPath(node) === path;
}

function isExactLengthRead(node, name) {
  return isExactPropertyRead(node, `${name}.length`);
}

function isExactCharCodeAt(node, name) {
  return (
    typescript.isCallExpression(node)
    && propertyAccessPath(node.expression) === `${name}.charCodeAt`
    && node.arguments.length === 1
    && isExactIdentifier(node.arguments[0], 'index')
  );
}

function isExactCharCodeOrZero(node, name) {
  const value = unwrapExpression(node);
  return (
    typescript.isBinaryExpression(value)
    && value.operatorToken.kind === typescript.SyntaxKind.BarBarToken
    && isExactCharCodeAt(unwrapExpression(value.left), name)
    && typescript.isNumericLiteral(unwrapExpression(value.right))
    && unwrapExpression(value.right).text === '0'
  );
}

function isExactTimingSafeLoop(statement) {
  if (
    !typescript.isForStatement(statement)
    || !statement.initializer
    || !typescript.isVariableDeclarationList(statement.initializer)
    || (statement.initializer.flags & typescript.NodeFlags.Let) === 0
    || statement.initializer.declarations.length !== 1
    || !statement.condition
    || !statement.incrementor
    || !typescript.isBlock(statement.statement)
    || statement.statement.statements.length !== 1
  ) {
    return false;
  }
  const [index] = statement.initializer.declarations;
  const condition = statement.condition;
  const incrementor = statement.incrementor;
  const update = statement.statement.statements[0];
  if (
    !typescript.isIdentifier(index.name)
    || index.name.text !== 'index'
    || !index.initializer
    || !typescript.isNumericLiteral(index.initializer)
    || index.initializer.text !== '0'
    || !typescript.isBinaryExpression(condition)
    || condition.operatorToken.kind !== typescript.SyntaxKind.LessThanToken
    || !isExactIdentifier(condition.left, 'index')
    || !isExactIdentifier(condition.right, 'maxLength')
    || !typescript.isPostfixUnaryExpression(incrementor)
    || incrementor.operator !== typescript.SyntaxKind.PlusPlusToken
    || !isExactIdentifier(incrementor.operand, 'index')
    || !typescript.isExpressionStatement(update)
    || !typescript.isBinaryExpression(update.expression)
    || update.expression.operatorToken.kind !== typescript.SyntaxKind.BarEqualsToken
    || !isExactIdentifier(update.expression.left, 'mismatch')
  ) {
    return false;
  }
  const xor = unwrapExpression(update.expression.right);
  return (
    typescript.isBinaryExpression(xor)
    && xor.operatorToken.kind === typescript.SyntaxKind.CaretToken
    && isExactCharCodeOrZero(xor.left, 'left')
    && isExactCharCodeOrZero(xor.right, 'right')
  );
}

function timingSafeStringEqualIssues(sourceFile) {
  const issues = [];
  const functions = topLevelFunctionsByName(sourceFile, 'timingSafeStringEqual');
  if (functions.length !== 1 || !functions[0].body) {
    return ['timingSafeStringEqual must remain one reviewed top-level helper'];
  }
  const [helper] = functions;
  if (
    hasModifier(helper, typescript.SyntaxKind.ExportKeyword)
    || helper.parameters.length !== 2
    || !isExactIdentifier(helper.parameters[0].name, 'left')
    || !isExactIdentifier(helper.parameters[1].name, 'right')
    || helper.body.statements.length !== 4
  ) {
    return ['timingSafeStringEqual must retain its reviewed local accumulator implementation'];
  }
  const [maxLength, mismatch, loop, result] = helper.body.statements;
  const maxLengthOk = isSingleIdentifierDeclaration(
    maxLength,
    'maxLength',
    (value) => (
      typescript.isCallExpression(value)
      && propertyAccessPath(value.expression) === 'Math.max'
      && value.arguments.length === 2
      && isExactLengthRead(value.arguments[0], 'left')
      && isExactLengthRead(value.arguments[1], 'right')
    ),
  );
  const mismatchOk = (
    typescript.isVariableStatement(mismatch)
    && (mismatch.declarationList.flags & typescript.NodeFlags.Let) !== 0
    && mismatch.declarationList.declarations.length === 1
    && isExactIdentifier(mismatch.declarationList.declarations[0].name, 'mismatch')
    && Boolean(mismatch.declarationList.declarations[0].initializer)
    && (() => {
      const value = mismatch.declarationList.declarations[0].initializer;
      return (
        typescript.isConditionalExpression(value)
        && typescript.isBinaryExpression(value.condition)
        && value.condition.operatorToken.kind === typescript.SyntaxKind.EqualsEqualsEqualsToken
        && isExactLengthRead(value.condition.left, 'left')
        && isExactLengthRead(value.condition.right, 'right')
        && typescript.isNumericLiteral(value.whenTrue)
        && value.whenTrue.text === '0'
        && typescript.isNumericLiteral(value.whenFalse)
        && value.whenFalse.text === '1'
      );
    })()
  );
  const resultOk = isDirectReturn(
    result,
    (value) => (
      typescript.isBinaryExpression(value)
      && value.operatorToken.kind === typescript.SyntaxKind.EqualsEqualsEqualsToken
      && isExactIdentifier(value.left, 'mismatch')
      && typescript.isNumericLiteral(value.right)
      && value.right.text === '0'
    ),
  );
  if (!maxLengthOk || !mismatchOk || !isExactTimingSafeLoop(loop) || !resultOk) {
    issues.push('timingSafeStringEqual must retain the reviewed length-aware character accumulator');
  }
  return issues;
}

function isExactReviewedSentryRuntimeImport(statement) {
  if (
    !typescript.isImportDeclaration(statement)
    || !typescript.isStringLiteral(statement.moduleSpecifier)
    || statement.moduleSpecifier.text !== reviewedSentryModuleSpecifier
    || !statement.importClause
    || statement.importClause.isTypeOnly
    || statement.importClause.name
  ) {
    return false;
  }
  const named = statement.importClause.namedBindings;
  return (
    Boolean(named)
    && typescript.isNamespaceImport(named)
    && named.name.text === 'Sentry'
  );
}

function isReviewedSentryEnvironmentArgument(argument) {
  return typescript.isStringLiteral(argument) && reviewedSentryEnvironmentNames.has(argument.text);
}

function isReviewedSentryEnvironmentRead(node) {
  return isDenoEnvRead(
    node,
    (argument) => isReviewedSentryEnvironmentArgument(argument),
  );
}

function isReviewedTrimmedSentryEnvironmentRead(node) {
  if (
    !typescript.isCallExpression(node)
    || node.arguments.length !== 0
    || !typescript.isPropertyAccessExpression(node.expression)
    || node.expression.name.text !== 'trim'
  ) {
    return false;
  }
  return isReviewedSentryEnvironmentRead(node.expression.expression);
}

function nullishChainParts(node) {
  const value = unwrapExpression(node);
  if (
    typescript.isBinaryExpression(value)
    && value.operatorToken.kind === typescript.SyntaxKind.QuestionQuestionToken
  ) {
    return [...nullishChainParts(value.left), ...nullishChainParts(value.right)];
  }
  return [value];
}

function isExactReviewedSentryEnvChain(node, environmentNames, fallback) {
  const parts = nullishChainParts(node);
  if (parts.length !== environmentNames.length + 1) return false;
  for (const [index, name] of environmentNames.entries()) {
    if (
      !isDenoEnvRead(
        parts[index],
        (argument) => typescript.isStringLiteral(argument) && argument.text === name,
      )
    ) {
      return false;
    }
  }
  const terminal = parts[parts.length - 1];
  if (typeof fallback === 'string') {
    return typescript.isStringLiteral(terminal) && terminal.text === fallback;
  }
  return isExactIdentifier(terminal, 'undefined');
}

function isExactReviewedSampleRateCall(node) {
  const value = unwrapExpression(node);
  return (
    isNamedCall(value, 'readSampleRate')
    && value.arguments.length === 1
    && typescript.isNumericLiteral(value.arguments[0])
    && value.arguments[0].text === '0.1'
  );
}

function isExactReviewedSentryInitCall(node) {
  if (
    !typescript.isCallExpression(node)
    || propertyAccessPath(node.expression) !== 'Sentry.init'
    || node.arguments.length !== 1
    || !typescript.isObjectLiteralExpression(node.arguments[0])
  ) {
    return false;
  }

  const properties = node.arguments[0].properties;
  const names = properties.map((property) => {
    if (typescript.isPropertyAssignment(property) || typescript.isShorthandPropertyAssignment(property)) {
      return propertyName(property.name);
    }
    return null;
  });
  if (
    names.some((name) => name === null)
    || !hasExactlyNames(names, ['dsn', 'defaultIntegrations', 'environment', 'release', 'tracesSampleRate'])
  ) {
    return false;
  }

  const byName = new Map(
    properties.map((property) => [
      (typescript.isPropertyAssignment(property) || typescript.isShorthandPropertyAssignment(property))
        ? propertyName(property.name)
        : null,
      property,
    ]),
  );
  const dsn = byName.get('dsn');
  const defaultIntegrations = byName.get('defaultIntegrations');
  const environment = byName.get('environment');
  const release = byName.get('release');
  const tracesSampleRate = byName.get('tracesSampleRate');
  return (
    typescript.isShorthandPropertyAssignment(dsn)
    && dsn.name.text === 'dsn'
    && typescript.isPropertyAssignment(defaultIntegrations)
    && unwrapExpression(defaultIntegrations.initializer).kind === typescript.SyntaxKind.FalseKeyword
    && typescript.isPropertyAssignment(environment)
    && isExactReviewedSentryEnvChain(
      environment.initializer,
      ['SENTRY_ENVIRONMENT', 'ENVIRONMENT'],
      'production',
    )
    && typescript.isPropertyAssignment(release)
    && isExactReviewedSentryEnvChain(
      release.initializer,
      ['SENTRY_RELEASE', 'DEPLOY_GIT_SHA'],
      undefined,
    )
    && typescript.isPropertyAssignment(tracesSampleRate)
    && isExactReviewedSampleRateCall(tracesSampleRate.initializer)
  );
}

function isSentryInitializationReferenceIdentifier(node) {
  const parent = node.parent;
  return !(
    (typescript.isPropertyAccessExpression(parent) && parent.name === node)
    || (
      (typescript.isPropertyAssignment(parent) || typescript.isShorthandPropertyAssignment(parent))
      && parent.name === node
    )
    || (
      (typescript.isVariableDeclaration(parent)
        || typescript.isParameter(parent)
        || typescript.isFunctionDeclaration(parent))
      && parent.name === node
    )
  );
}

function bindingIdentifierNames(name, names = []) {
  if (typescript.isIdentifier(name)) {
    names.push(name.text);
    return names;
  }
  if (typescript.isObjectBindingPattern(name) || typescript.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (typescript.isOmittedExpression(element)) continue;
      bindingIdentifierNames(element.name, names);
    }
  }
  return names;
}

function sentryTopLevelRuntimeBindingIssues(sourceFile) {
  const issues = [];
  const report = (name) => {
    if (reviewedSentryRuntimeBindingNames.has(name)) {
      issues.push('Sentry initialization may not shadow reviewed runtime binding ' + name);
    }
  };
  for (const statement of sourceFile.statements) {
    if (typescript.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingIdentifierNames(declaration.name)) report(name);
      }
      continue;
    }
    if (
      (typescript.isFunctionDeclaration(statement)
        || typescript.isClassDeclaration(statement)
        || typescript.isEnumDeclaration(statement)
        || typescript.isModuleDeclaration(statement))
      && statement.name
      && typescript.isIdentifier(statement.name)
    ) {
      report(statement.name.text);
    }
  }
  return issues;
}

function sentryInitializationIssues(source) {
  const sourceFile = typescript.createSourceFile(
    'sentry-initialization-source-contract.ts',
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const issues = [];
  if (sourceFile.parseDiagnostics.length > 0) {
    issues.push('Sentry initialization module must remain parseable');
    return issues;
  }

  const imports = sourceFile.statements.filter(typescript.isImportDeclaration);
  if (imports.length !== 1 || !isExactReviewedSentryRuntimeImport(imports[0])) {
    issues.push('Sentry initialization must retain exactly the reviewed pinned Sentry namespace import');
  }
  issues.push(...sentryTopLevelRuntimeBindingIssues(sourceFile));

  const localFunctions = new Map();
  for (const statement of sourceFile.statements) {
    if (!typescript.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    if (localFunctions.has(statement.name.text)) {
      issues.push('Sentry initialization contains duplicate top-level helper ' + statement.name.text);
      continue;
    }
    localFunctions.set(statement.name.text, statement);
  }
  const init = localFunctions.get('initSentryEdge');
  if (
    !init
    || !hasModifier(init, typescript.SyntaxKind.ExportKeyword)
    || hasModifier(init, typescript.SyntaxKind.AsyncKeyword)
    || init.parameters.length !== 0
  ) {
    issues.push('initSentryEdge must remain one synchronous exported zero-argument initializer');
    return issues;
  }
  const readSampleRate = localFunctions.get('readSampleRate');
  if (
    !readSampleRate
    || hasModifier(readSampleRate, typescript.SyntaxKind.ExportKeyword)
    || hasModifier(readSampleRate, typescript.SyntaxKind.AsyncKeyword)
    || Boolean(readSampleRate.asteriskToken)
    || containsDecorator(readSampleRate)
    || readSampleRate.parameters.length !== 1
    || !isExactIdentifier(readSampleRate.parameters[0].name, 'fallback')
    || Boolean(readSampleRate.parameters[0].dotDotDotToken)
    || Boolean(readSampleRate.parameters[0].questionToken)
    || Boolean(readSampleRate.parameters[0].initializer)
  ) {
    issues.push('readSampleRate must retain one plain non-default fallback parameter');
    return issues;
  }

  const allowedIdentifiersByFunction = {
    initSentryEdge: new Set([
      'initialized',
      'enabled',
      'dsn',
      'Deno',
      'Boolean',
      'Sentry',
      'readSampleRate',
      'undefined',
    ]),
    readSampleRate: new Set([
      'fallback',
      'raw',
      'value',
      'Deno',
      'Number',
      'Math',
    ]),
  };
  const pending = ['initSentryEdge'];
  const inspected = new Set();
  let reviewedInitCalls = 0;
  const blockedIdentifiers = new Set([
    'globalThis',
    'fetch',
    'createClient',
    'supabase',
    'require',
    'eval',
    'Function',
    'Proxy',
    'Reflect',
    'WebAssembly',
    'process',
  ]);

  while (pending.length > 0) {
    const functionName = pending.pop();
    if (!functionName || inspected.has(functionName)) continue;
    const declaration = localFunctions.get(functionName);
    if (!declaration?.body) {
      issues.push('Sentry initializer may not reach an unresolved local helper ' + functionName);
      continue;
    }
    inspected.add(functionName);
    const allowedIdentifiers = allowedIdentifiersByFunction[functionName] ?? new Set();
    const approvedCallRanges = [];
    const approvedDenoRanges = [];

    const isReviewedInitializationCall = (node) => {
      if (isExactReviewedSentryInitCall(node)) {
        reviewedInitCalls += 1;
        return true;
      }
      if (
        isReviewedSentryEnvironmentRead(node)
        || isReviewedTrimmedSentryEnvironmentRead(node)
      ) {
        approvedDenoRanges.push({ start: node.pos, end: node.end });
        return true;
      }
      const path = propertyAccessPath(node.expression);
      if (['Number.isFinite', 'Math.max', 'Math.min'].includes(path)) return true;
      if (
        typescript.isIdentifier(node.expression)
        && ['Boolean', 'Number'].includes(node.expression.text)
      ) {
        return true;
      }
      return (
        functionName === 'initSentryEdge'
        && isExactReviewedSampleRateCall(node)
      );
    };

    const collectApprovedCallRanges = (node) => {
      if (typescript.isCallExpression(node) && isReviewedInitializationCall(node)) {
        approvedCallRanges.push({ start: node.pos, end: node.end });
      }
      typescript.forEachChild(node, collectApprovedCallRanges);
    };
    collectApprovedCallRanges(declaration.body);

    const isInside = (node, ranges) => ranges.some(
      (range) => range.start <= node.pos && node.end <= range.end,
    );
    const visit = (node) => {
      if (typescript.isFunctionLike(node)) {
        issues.push(functionName + ' may not create nested executable initialization callbacks');
        return;
      }
      if (
        typescript.isNewExpression(node)
        || typescript.isTaggedTemplateExpression(node)
        || typescript.isAwaitExpression(node)
        || typescript.isYieldExpression(node)
      ) {
        issues.push(functionName + ' may not use deferred or dynamic initialization execution');
      }
      if (
        typescript.isPrefixUnaryExpression(node)
        && [
          typescript.SyntaxKind.PlusPlusToken,
          typescript.SyntaxKind.MinusMinusToken,
          typescript.SyntaxKind.DeleteKeyword,
        ].includes(node.operator)
      ) {
        issues.push(functionName + ' may not mutate runtime objects during module initialization');
      }
      if (
        typescript.isBinaryExpression(node)
        && node.operatorToken.kind >= typescript.SyntaxKind.FirstAssignment
        && node.operatorToken.kind <= typescript.SyntaxKind.LastAssignment
        && (
          typescript.isPropertyAccessExpression(node.left)
          || typescript.isElementAccessExpression(node.left)
        )
      ) {
        issues.push(functionName + ' may not mutate runtime object properties during module initialization');
      }
      if (typescript.isCallExpression(node) && !isInside(node, approvedCallRanges)) {
        if (node.expression.kind === typescript.SyntaxKind.ImportKeyword) {
          issues.push(functionName + ' may not dynamically import during module initialization');
        } else if (isRawFetchCall(node) || isServiceCredentialRead(node)) {
          issues.push(functionName + ' may not access service credentials or issue network requests');
        } else {
          issues.push(functionName + ' may only make reviewed Sentry, environment, and numeric helper calls');
        }
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && !isInside(node, approvedCallRanges)
      ) {
        issues.push(functionName + ' may not access unreviewed runtime object properties during module initialization');
      }
      if (typescript.isStringLiteral(node) && ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(node.text)) {
        issues.push(functionName + ' may not reference a Supabase service credential during module initialization');
      }
      const reportRuntimeBinding = (name) => {
        for (const bindingName of bindingIdentifierNames(name)) {
          if (reviewedSentryRuntimeBindingNames.has(bindingName)) {
            issues.push(functionName + ' may not shadow a reviewed initialization binding');
          }
        }
      };
      if (typescript.isVariableDeclaration(node)) {
        reportRuntimeBinding(node.name);
      }
      if (typescript.isCatchClause(node) && node.variableDeclaration) {
        reportRuntimeBinding(node.variableDeclaration.name);
      }
      if (
        (typescript.isClassDeclaration(node)
          || typescript.isEnumDeclaration(node)
          || typescript.isModuleDeclaration(node))
        && node.name
        && typescript.isIdentifier(node.name)
      ) {
        reportRuntimeBinding(node.name);
      }
      if (typescript.isIdentifier(node) && isSentryInitializationReferenceIdentifier(node)) {
        if (localFunctions.has(node.text) && node.text !== functionName) {
          pending.push(node.text);
        }
        if (blockedIdentifiers.has(node.text)) {
          issues.push(functionName + ' may not reference privileged or dynamic runtime capability ' + node.text);
        } else if (
          node.text === 'Deno'
          && !isInside(node, approvedDenoRanges)
        ) {
          issues.push(functionName + ' may only use Deno through reviewed environment reads');
        } else if (!allowedIdentifiers.has(node.text)) {
          issues.push(functionName + ' references unreviewed initialization binding ' + node.text);
        }
      }
      typescript.forEachChild(node, visit);
    };
    for (const statement of declaration.body.statements) visit(statement);
  }

  if (reviewedInitCalls !== 1) {
    issues.push('initSentryEdge must make exactly one reviewed Sentry.init call');
  }
  return issues;
}

function internalAuthSemanticIssues(source) {
  const sourceFile = typescript.createSourceFile(
    'internal-auth-source-contract.ts',
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const issues = [];
  if (sourceFile.parseDiagnostics.length > 0) {
    issues.push('internal auth helper must remain parseable');
    return issues;
  }
  issues.push(...internalAuthModuleStructureIssues(sourceFile));
  const helpers = topLevelFunctionsByName(sourceFile, 'requireInternalAuth');
  if (helpers.length !== 1 || !helpers[0].body) {
    issues.push('requireInternalAuth must remain one exported top-level helper');
    return issues;
  }
  const [helper] = helpers;
  if (
    !hasModifier(helper, typescript.SyntaxKind.ExportKeyword)
    || !hasModifier(helper, typescript.SyntaxKind.AsyncKeyword)
    || helper.parameters.length !== 3
    || !isExactIdentifier(helper.parameters[0].name, 'req')
    || !isExactIdentifier(helper.parameters[1].name, 'corsHeaders')
    || !isExactIdentifier(helper.parameters[2].name, 'options')
    || !helper.parameters[2].initializer
    || !typescript.isObjectLiteralExpression(helper.parameters[2].initializer)
    || helper.parameters[2].initializer.properties.length !== 0
    || /\bsupabase\b|\.rpc\s*\(|verify_webhook_internal_token/.test(helper.getText(sourceFile))
  ) {
    issues.push('requireInternalAuth must remain a local helper without a privileged database verifier');
  }
  const statements = helper.body.statements;
  if (statements.length !== 7) {
    issues.push('requireInternalAuth must retain exactly its reviewed credential and rejection control flow');
  } else {
    const [token, expected, authHeader, serviceKey, sharedSecretGuard, bearerGuard, unauthorized] = statements;
    const tokenOk = isSingleIdentifierDeclaration(
      token,
      'token',
      (value) => isTrimmedHeaderRead(value, 'x-internal-token'),
    );
    const expectedOk = isSingleIdentifierDeclaration(
      expected,
      'expected',
      (value) => isExactSecretResolution(value, 'sharedSecret', 'WEBHOOK_SHARED_SECRET', true),
    );
    const authHeaderOk = isSingleIdentifierDeclaration(
      authHeader,
      'authHeader',
      (value) => isOrEmptyString(value, (candidate) => isRequestHeaderRead(candidate, 'Authorization')),
    );
    const serviceKeyOk = isSingleIdentifierDeclaration(
      serviceKey,
      'serviceKey',
      (value) => isExactSecretResolution(value, 'serviceRoleKey', 'SUPABASE_SERVICE_ROLE_KEY', false),
    );
    if (!tokenOk || !expectedOk || !authHeaderOk || !serviceKeyOk) {
      issues.push('requireInternalAuth credential inputs must retain their reviewed request and environment provenance');
    }
    if (!isExactCredentialGuard(sharedSecretGuard, 'expected', 'token', 'expected')) {
      issues.push('internal token success must use the reviewed timing-safe comparison');
    }
    if (!isExactCredentialGuard(bearerGuard, 'serviceKey', 'authHeader', 'serviceKey', 'Bearer ')) {
      issues.push('service bearer success must use the reviewed timing-safe comparison');
    }
    if (!isUnauthorizedResponseReturn(unauthorized)) {
      issues.push('requireInternalAuth must retain its final 401 rejection response');
    }
  }
  issues.push(...timingSafeStringEqualIssues(sourceFile));
  return issues;
}

function validate(sources) {
  let denoConfig;
  try {
    denoConfig = JSON.parse(sources.denoConfig);
  } catch {
    assert.fail('deno.json must remain valid JSON for Edge-auth source validation');
  }
  assert.equal(
    denoConfig?.compilerOptions?.experimentalDecorators,
    false,
    'deno.json must pin experimentalDecorators=false to prevent executable decorator initialization',
  );
  const configured = functionConfigEntries(sources.config);
  const configuredNames = [...configured.keys()].sort();
  const expectedNames = Object.keys(expectedFunctions).sort();
  assert.deepEqual(configuredNames, expectedNames, 'function config inventory must exactly match the reviewed function set');
  assert.deepEqual(localFunctionNames(), expectedNames, 'local Edge Function inventory must exactly match the reviewed function set');
  for (const [name, expectedVerifyJwt] of Object.entries(expectedFunctions)) {
    assert.equal(configured.get(name), expectedVerifyJwt, `${name} verify_jwt contract changed without review`);
    assert.match(
      sources.matrix,
      new RegExp(`\\|\\s*\\\`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\\`\\s*\\|\\s*\\\`${expectedVerifyJwt}\\\``),
      `${name} must have a matching auth-matrix row`,
    );
  }

  assert.match(sources.matrix, /Auth is local and fail-closed before service-client creation/, 'auth matrix must document the pre-service-client boundary');
  assert.doesNotMatch(sources.matrix, /accepted by `verify_webhook_internal_token`/, 'auth matrix may not document a service-RPC fallback');
  assert.match(sources.runbook, /Validation is local and fail-closed before a service-role client is created/, 'runbook must document the fail-closed deployment requirement');
  assert.doesNotMatch(sources.runbook, /Validation uses the Postgres RPC `verify_webhook_internal_token`/, 'runbook may not document a service-RPC fallback');

  const closureIssues = guardedImportClosureIssues();
  assert.equal(
    closureIssues.length,
    0,
    `guarded Edge-auth dependency closure may not initialize or import a privileged client before request auth: ${closureIssues.join('; ')}`,
  );

  const sentryIssues = sentryInitializationIssues(sources.sentry);
  assert.equal(
    sentryIssues.length,
    0,
    `Sentry module initialization must remain capability-free before request auth: ${sentryIssues.join('; ')}`,
  );

  const internalAuthIssues = internalAuthSemanticIssues(sources.internalAuth);
  assert.equal(
    internalAuthIssues.length,
    0,
    `internal auth helper must remain local, timing-safe, and fail-closed: ${internalAuthIssues.join('; ')}`,
  );

  for (const [name, contract] of Object.entries(internalEntrypoints)) {
    const source = sources.internalEntrypoints[name];
    const boundaryIssues = contract.supabaseModule
      ? directEntrypointIssues(source, contract, name)
      : handlerFactoryStructureIssues(
        source,
        { ...internalWrappers[name], request: contract.request, serviceFactory: contract.serviceFactory },
        name,
      );
    assert.equal(
      boundaryIssues.length,
      0,
      `${name} must keep its reviewed served auth boundary and privileged-client construction: ${boundaryIssues.join('; ')}`,
    );
  }

  for (const [name, contract] of Object.entries(internalWrappers)) {
    const source = sources.internalWrappers[name];
    const clientIssues = wrapperCreateClientIssues(source, contract);
    assert.equal(
      clientIssues.length,
      0,
      `${name} wrapper must not eagerly construct or alias a service client outside its lazy factory: ${clientIssues.join('; ')}`,
    );
    const handlerResult = handlerModuleIssues(sources.internalEntrypoints[name], contract);
    assert.equal(
      handlerResult.issues.length,
      0,
      `${name} handler module must not initialize or construct a privileged client: ${handlerResult.issues.join('; ')}`,
    );
  }

  assert.match(sources.internalEntrypoints.worker, /const authError = await requireInternalAuth\(req, corsHeaders\);\s*if \(authError\) return authError;\s*const supabase = createClient/, 'worker must reject before service client construction');
  assert.match(sources.internalEntrypoints['x-poster'], /const authErr = await requireInternalAuth\(req, corsHeaders\);\s*if \(authErr\) return authErr;\s*const supabaseUrl/, 'x-poster must reject before reading service-client inputs');
  assert.match(sources.internalEntrypoints['x-followers-snapshot'], /const authErr = await requireInternalAuth\(req, corsHeaders\);\s*if \(authErr\) return authErr;\s*const supabase = createClient/, 'follower snapshots must reject before service client construction');
  assert.match(sources.internalEntrypoints['digest-compiler'], /const authError = await requireInternalAuth\(req, corsHeaders\);\s*if \(authError\) return authError;\s*const supabaseUrl/, 'digest compiler must reject before reading service-client inputs');
}

function loadSources() {
  return {
    config: read(configPath),
    denoConfig: read(denoConfigPath),
    matrix: read(matrixPath),
    runbook: read(runbookPath),
    internalAuth: read(internalAuthPath),
    sentry: read(sentryPath),
    internalEntrypoints: Object.fromEntries(
      Object.entries(internalEntrypoints).map(([name, contract]) => [name, read(contract.path)]),
    ),
    internalWrappers: Object.fromEntries(
      Object.entries(internalWrappers).map(([name, contract]) => [name, read(contract.path)]),
    ),
  };
}

const sources = loadSources();
validate(sources);

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const expectRejected = (label, mutate) => {
    assert.throws(
      () => validate(mutate(sources)),
      (error) => String(error).includes('INTERNAL_EDGE_AUTH_SOURCE_CONTRACT_FAIL') || error instanceof assert.AssertionError,
      `${label} mutation must fail the source contract`,
    );
  };
  expectRejected('experimental decorators enabled', (source) => ({
    ...source,
    denoConfig: source.denoConfig.replace(
      '"experimentalDecorators": false',
      '"experimentalDecorators": true',
    ),
  }));
  expectRejected('Sentry initializer service credential', (source) => ({
    ...source,
    sentry: source.sentry.replace(
      'const dsn = Deno.env.get("SENTRY_DSN")?.trim();',
      'const dsn = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();',
    ),
  }));
  expectRejected('Sentry sample-rate fragmented credential name', (source) => ({
    ...source,
    sentry: source.sentry.replace(
      'const raw = Deno.env.get("SENTRY_TRACES_SAMPLE_RATE")?.trim();',
      'const name = "SUPABASE_SERVICE_ROLE_" + "KEY";\n  const raw = Deno.env.get(name)?.trim();',
    ),
  }));
  expectRejected('Sentry sample-rate default credential parameter', (source) => ({
    ...source,
    sentry: source.sentry.replace(
      'function readSampleRate(fallback: number): number {',
      'function readSampleRate(fallback: number, _credential = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")): number {',
    ),
  }));
  expectRejected('Sentry initializer Boolean shadow default credential', (source) => ({
    ...source,
    sentry: source.sentry.replace(
      'export function initSentryEdge(): boolean {',
      'function Boolean(_value: unknown, _credential = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")): boolean { return true; }\n\nexport function initSentryEdge(): boolean {',
    ),
  }));
  expectRejected('Sentry initializer catch binding shadow', (source) => ({
    ...source,
    sentry: source.sentry.replace(
      'initialized = true;',
      'initialized = true;\n  try { throw null; } catch (Boolean) {}',
    ),
  }));
  expectRejected('Sentry initializer dynamic import', (source) => ({
    ...source,
    sentry: source.sentry.replace(
      'initialized = true;',
      'initialized = true;\n  void import("https://attacker.example/edge-client.ts");',
    ),
  }));
  expectRejected('direct Sentry import alias trampoline', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-followers-snapshot': source.internalEntrypoints['x-followers-snapshot'].replace(
        'import { captureEdgeException, initSentryEdge } from "../_shared/sentry.ts";',
        'import { captureEdgeException, captureEdgeException as initSentryEdge } from "../_shared/sentry.ts";',
      ),
    },
  }));
  expectRejected('x-poster top-level service fetch', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-poster': source.internalEntrypoints['x-poster'].replace(
        'Deno.serve(async (req) => {',
        "void fetch('https://attacker.example', { headers: { 'x-service-key': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' } });\nDeno.serve(async (req) => {",
      ),
    },
  }));
  expectRejected('x-poster dynamic global Deno alias', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-poster': source.internalEntrypoints['x-poster'].replace(
        'Deno.serve(async (req) => {',
        "const root = globalThis;\nconst denoKey = 'Deno';\nconst runtime = root[denoKey];\nruntime.serve = () => undefined;\nDeno.serve(async (req) => {",
      ),
    },
  }));
  expectRejected('service RPC fallback', (source) => ({
    ...source,
    internalAuth: source.internalAuth.replace(
      "if (expected && timingSafeStringEqual(token, expected)) return null;",
      "if (expected && timingSafeStringEqual(token, expected)) return null;\n  await supabase.rpc('verify_webhook_internal_token', { p_token: token });",
    ),
  }));
  expectRejected('worker pre-auth service client', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      worker: source.internalEntrypoints.worker.replace(
        'const authError = await requireInternalAuth(req, corsHeaders);',
        "const preAuthService = createClient<any, any>('', '');\n  const authError = await requireInternalAuth(req, corsHeaders);",
      ),
    },
  }));
  expectRejected('handler pre-auth service client', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'media-processor': source.internalEntrypoints['media-processor'].replace(
        'const authError = await requireInternalAuth(request, corsHeaders);',
        'const preAuthService = createSupabase();\n    const authError = await requireInternalAuth(request, corsHeaders);',
      ),
    },
  }));
  expectRejected('cleanup validator capability escape', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'db-cleanup': source.internalEntrypoints['db-cleanup'].replace(
        'return client as CleanupSupabaseClient;',
        'return createSupabase() as CleanupSupabaseClient;',
      ),
    },
  }));
  for (const operator of ['=', '??=', '||=']) {
    expectRejected(`wrapper eager service client ${operator}`, (source) => ({
      ...source,
      internalWrappers: {
        ...source.internalWrappers,
        'media-processor': source.internalWrappers['media-processor'].replace(
          'const handler = createMediaProcessorHandler({',
          `let cachedServiceClient;\ncachedServiceClient ${operator} createClient<any, any>('', '');\n\nconst handler = createMediaProcessorHandler({`,
        ),
      },
    }));
  }
  expectRejected('wrapper createClient alias', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        "import { createClient } from \"https://esm.sh/@supabase/supabase-js@2.39.7\";",
        "import { createClient as makeClient } from \"https://esm.sh/@supabase/supabase-js@2.39.7\";",
      ),
    },
  }));
  expectRejected('wrapper createClient identifier escape', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        'const handler = createMediaProcessorHandler({',
        'const makeClient = createClient;\n\nconst handler = createMediaProcessorHandler({',
      ),
    },
  }));
  expectRejected('function verify-jwt drift', (source) => ({
    ...source,
    config: source.config.replace('[functions.worker]\nverify_jwt = false', '[functions.worker]\nverify_jwt = true'),
  }));
  expectRejected('auth-matrix drift', (source) => ({
    ...source,
    matrix: source.matrix.replace('| `worker` | `false`', '| `worker` | `true`'),
  }));
  expectRejected('wrapper bracket-accessed service factory', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        'const handler = createMediaProcessorHandler({',
        'const eager = SupabaseJs["createClient"]("", "");\n\nconst handler = createMediaProcessorHandler({',
      ),
    },
  }));
  expectRejected('unrelated eager createSupabase arrow', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        'const handler = createMediaProcessorHandler({',
        'const eager = { createSupabase: () => createClient<any, any>("", "") }.createSupabase();\n\nconst handler = createMediaProcessorHandler({',
      ),
    },
  }));
  expectRejected('wrapper dynamic namespace service factory', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor']
        .replace(
          'import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";',
          'import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";\nimport * as SupabaseJs from "https://esm.sh/@supabase/supabase-js@2.39.7";',
        )
        .replace(
          'const handler = createMediaProcessorHandler({',
          'const method = ["create", "Client"].join("");\nconst eager = SupabaseJs[method]("", "");\n\nconst handler = createMediaProcessorHandler({',
        ),
    },
  }));
  expectRejected('wrapper reflection service factory', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        'const handler = createMediaProcessorHandler({',
        'const eager = Reflect.get(globalThis, "createClient");\n\nconst handler = createMediaProcessorHandler({',
      ),
    },
  }));
  expectRejected('imposter Supabase import', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        'https://esm.sh/@supabase/supabase-js@2.39.7',
        'https://evil.example/client.js?pkg=@supabase/supabase-js',
      ),
    },
  }));
  expectRejected('type-only createClient import', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        'import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";',
        'import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";',
      ),
    },
  }));
  expectRejected('dependency-object override', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        '  requireInternalAuth,',
        '  ...{ createSupabase: () => makeEagerServiceClient() },\n  requireInternalAuth,',
      ),
    },
  }));
  expectRejected('decoy handler registration', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        'serve(handler);',
        'serve(eagerHandler);',
      ),
    },
  }));
  expectRejected('local eager service-client helper', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor']
        .replace(
          'import { requireInternalAuth } from "../_shared/internalAuth.ts";',
          'import { requireInternalAuth } from "../_shared/internalAuth.ts";\nimport { makeServiceClient } from "./serviceClient.ts";',
        )
        .replace(
          'const handler = createMediaProcessorHandler({',
          'const eager = makeServiceClient();\n\nconst handler = createMediaProcessorHandler({',
        ),
    },
  }));
  expectRejected('internal auth unconditional success', (source) => ({
    ...source,
    internalAuth: source.internalAuth.replace(
      'if (expected && timingSafeStringEqual(token, expected)) return null;',
      'if (true) return null;\n  if (expected && timingSafeStringEqual(token, expected)) return null;',
    ),
  }));
  expectRejected('handler ignores auth rejection', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'media-processor': source.internalEntrypoints['media-processor'].replace(
        'if (authError) return authError;',
        'if (authError) console.log("ignored");',
      ),
    },
  }));
  expectRejected('service client endpoint substitution', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        "Deno.env.get('SUPABASE_URL') ?? ''",
        "'https://attacker.example'",
      ),
    },
  }));
  expectRejected('auth dependency substitution', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        '  requireInternalAuth,',
        '  requireInternalAuth: async () => null,',
      ),
    },
  }));
  expectRejected('wrapper re-export side effect', (source) => ({
    ...source,
    internalWrappers: {
      ...source.internalWrappers,
      'media-processor': source.internalWrappers['media-processor'].replace(
        'import { requireInternalAuth } from "../_shared/internalAuth.ts";',
        'export * from "./eager-client.ts";\nimport { requireInternalAuth } from "../_shared/internalAuth.ts";',
      ),
    },
  }));
  expectRejected('handler dynamic client import', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'media-processor': source.internalEntrypoints['media-processor'].replace(
        'const authError = await requireInternalAuth(request, corsHeaders);',
        'const early = (await import("https://esm.sh/@supabase/supabase-js@2.39.7"))["createClient"]("", "");\n    const authError = await requireInternalAuth(request, corsHeaders);',
      ),
    },
  }));
  expectRejected('direct namespace client before auth', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      worker: source.internalEntrypoints.worker.replace(
        'import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";',
        'import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";\nimport * as SupabaseJs from "https://esm.sh/@supabase/supabase-js@2.39.7";',
      ).replace(
        'const authError = await requireInternalAuth(req, corsHeaders);',
        'const early = SupabaseJs["createClient"]("", "");\n  const authError = await requireInternalAuth(req, corsHeaders);',
      ),
    },
  }));
  expectRejected('direct fake destructured auth binding', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-followers-snapshot': source.internalEntrypoints['x-followers-snapshot'].replace(
        'import { requireInternalAuth } from "../_shared/internalAuth.ts";',
        'import { requireInternalAuth as trustedInternalAuth } from "../_shared/internalAuth.ts";\nconst { auth: requireInternalAuth } = { auth: async () => null };',
      ),
    },
  }));
  expectRejected('direct side-effect client module import', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'digest-compiler': source.internalEntrypoints['digest-compiler'].replace(
        'import { serve } from "https://deno.land/std@0.168.0/http/server.ts";',
        'import "./preauth-client.ts";\nimport { serve } from "https://deno.land/std@0.168.0/http/server.ts";',
      ),
    },
  }));
  expectRejected('direct served-handler decoy', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      worker: source.internalEntrypoints.worker.replace(
        'serve(async (req) => {',
        'async function decoy(req: Request) {\n  const authError = await requireInternalAuth(req, corsHeaders);\n  if (authError) return authError;\n  const supabase = createClient<any, any>("", "");\n}\n\nserve(async (req) => {',
      ).replace(
        'const authError = await requireInternalAuth(req, corsHeaders);',
        'const unsafe = createClient<any, any>("", "");',
      ),
    },
  }));
  expectRejected('internal auth untrusted expected provenance', (source) => ({
    ...source,
    internalAuth: source.internalAuth.replace(
      "const expected = typeof options.sharedSecret === 'string'\n    ? options.sharedSecret.trim()\n    : readOptionalEnv('WEBHOOK_SHARED_SECRET');",
      'const expected = token;',
    ),
  }));
  expectRejected('internal auth early falsey success', (source) => ({
    ...source,
    internalAuth: source.internalAuth.replace(
      "const token = (req.headers.get('x-internal-token') || '').trim();",
      "const token = (req.headers.get('x-internal-token') || '').trim();\n  return await Promise.resolve(null);",
    ),
  }));
  expectRejected('internal auth top-level privileged initialization', (source) => ({
    ...source,
    internalAuth: source.internalAuth.replace(
      "import {\n  buildRssWebhookSignatureInput,",
      "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';\nconst eager = createClient('', '');\nimport {\n  buildRssWebhookSignatureInput,",
    ),
  }));
  expectRejected('timing-safe always-zero accumulator', (source) => ({
    ...source,
    internalAuth: source.internalAuth.replace(
      'let mismatch = left.length === right.length ? 0 : 1;',
      'let mismatch = 0;',
    ),
  }));
  expectRejected('handler computed service capability before auth', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'db-cleanup': source.internalEntrypoints['db-cleanup'].replace(
        '  return async (request: Request): Promise<Response> => {',
        '  const { ["createSupabase"]: makeClient } = dependencies;\n  const eager = makeClient();\n\n  return async (request: Request): Promise<Response> => {',
      ),
    },
  }));
  expectRejected('x-poster local Deno shadow', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-poster': source.internalEntrypoints['x-poster'].replace(
        'Deno.serve(async (req) => {',
        'const Deno = { serve: () => undefined };\nDeno.serve(async (req) => {',
      ),
    },
  }));
  expectRejected('x-poster global Deno replacement', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-poster': source.internalEntrypoints['x-poster'].replace(
        'Deno.serve(async (req) => {',
        "globalThis['Deno'] = { serve: () => undefined };\nDeno.serve(async (req) => {",
      ),
    },
  }));
  expectRejected('x-poster Deno serve assignment', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-poster': source.internalEntrypoints['x-poster'].replace(
        'Deno.serve(async (req) => {',
        'Deno.serve = () => undefined;\nDeno.serve(async (req) => {',
      ),
    },
  }));
  expectRejected('x-poster Reflect Deno serve mutation', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-poster': source.internalEntrypoints['x-poster'].replace(
        'Deno.serve(async (req) => {',
        "Reflect.set(globalThis.Deno, 'serve', () => undefined);\nDeno.serve(async (req) => {",
      ),
    },
  }));
  expectRejected('x-poster Object.assign global Deno mutation', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-poster': source.internalEntrypoints['x-poster'].replace(
        'Deno.serve(async (req) => {',
        'Object.assign(globalThis, { Deno: { serve: () => undefined } });\nDeno.serve(async (req) => {',
      ),
    },
  }));
  expectRejected('x-poster unauthenticated pre-auth service fetch', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-poster': source.internalEntrypoints['x-poster'].replace(
        '  const authErr = await requireInternalAuth(req, corsHeaders);',
        "  await fetch('https://attacker.example', { headers: { 'x-service-key': Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' } });\n  const authErr = await requireInternalAuth(req, corsHeaders);",
      ),
    },
  }));
  expectRejected('x-poster unauthenticated finally path', (source) => ({
    ...source,
    internalEntrypoints: {
      ...source.internalEntrypoints,
      'x-poster': source.internalEntrypoints['x-poster'].replace(
        '  const authErr = await requireInternalAuth(req, corsHeaders);',
        "  const authErr = await requireInternalAuth(req, corsHeaders);\n  } finally {",
      ),
    },
  }));
  const expectClosureRejected = (label, overrides) => {
    assert.ok(
      guardedImportClosureIssues(overrides).length > 0,
      `${label} mutation must fail the guarded import-closure contract`,
    );
  };
  const sentryPath = join(functionsDirectory, '_shared', 'sentry.ts');
  const eagerClientPath = join(functionsDirectory, '_shared', 'eager-client.ts');
  expectClosureRejected('closure export-star privileged side effect', new Map([
    [
      sentryPath,
      `export * from './eager-client.ts';\n${read(sentryPath)}`,
    ],
    [
      eagerClientPath,
      `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';\nconst eager = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');`,
    ],
  ]));
  expectClosureRejected('closure local-init trampoline', new Map([
    [
      sentryPath,
      `function eager() { void import('https://esm.sh/@supabase/supabase-js@2.39.7').then((module) => module['createClient'](Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')); }\neager();\n${read(sentryPath)}`,
    ],
  ]));
  expectClosureRejected('closure remote side-effect import', new Map([
    [
      sentryPath,
      `import 'https://attacker.example/eager.ts';\n${read(sentryPath)}`,
    ],
  ]));
  expectClosureRejected('closure remote export-star', new Map([
    [
      sentryPath,
      `export * from 'https://attacker.example/eager.ts';\n${read(sentryPath)}`,
    ],
  ]));
  expectClosureRejected('closure parameter decorator initializer', new Map([
    [
      sentryPath,
      `function trap() { const url = Deno.env.get('SUPABASE_URL') ?? ''; const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''; void import('https://esm.sh/@supabase/supabase-js@2.39.7').then((module) => module.createClient(url, key)); }\nclass Trap { constructor(@trap _value: unknown) {} }\n${read(sentryPath)}`,
    ],
  ]));
  expectClosureRejected('closure Object.freeze Proxy spread', new Map([
    [
      sentryPath,
      `const trap = new Proxy({}, { ownKeys() { const url = Deno.env.get('SUPABASE_URL') ?? ''; const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''; void import('https://esm.sh/@supabase/supabase-js@2.39.7').then((module) => module.createClient(url, key)); return []; } });\nObject.freeze({ ...trap });\n${read(sentryPath)}`,
    ],
  ]));
  expectClosureRejected('closure class static initializer', new Map([
    [
      sentryPath,
      `class Trap { static { void Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); } }\n${read(sentryPath)}`,
    ],
  ]));
  expectClosureRejected('closure tagged-template trampoline', new Map([
    [
      sentryPath,
      `function tag() { void Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'); return ''; }\ntag\`run\`;\n${read(sentryPath)}`,
    ],
  ]));
  selfTest = 'pass';
}

console.log(`INTERNAL_EDGE_AUTH_SOURCE_CONTRACT_PASS functions=${Object.keys(expectedFunctions).length} internal=${Object.keys(internalEntrypoints).length} wrappers=${Object.keys(internalWrappers).length} selfTest=${selfTest}`);
