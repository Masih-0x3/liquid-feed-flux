import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(repoRoot, "src/App.tsx");
const layoutPath = join(repoRoot, "src/components/layout/AppLayout.tsx");
const layoutTestPath = join(repoRoot, "src/test/app-layout.test.tsx");
const require = createRequire(import.meta.url);
const typescript = require("typescript");
const appSource = readFileSync(appPath, "utf8");
const layoutSource = readFileSync(layoutPath, "utf8");
const layoutTestSource = readFileSync(layoutTestPath, "utf8");

function transpile(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
}

for (const [path, source] of [
  [appPath, appSource],
  [layoutPath, layoutSource],
  [layoutTestPath, layoutTestSource],
]) {
  transpile(path, source);
}

function sourceFile(path, source) {
  return typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.ES2022,
    true,
    typescript.ScriptKind.TSX,
  );
}

function findNodes(root, predicate) {
  const found = [];
  const visit = (node) => {
    if (predicate(node)) found.push(node);
    typescript.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function tagName(tag) {
  return typescript.isIdentifier(tag) ? tag.text : tag.getText();
}

function jsxAttribute(opening, name) {
  return opening.attributes.properties.find((attribute) =>
    typescript.isJsxAttribute(attribute) && attribute.name.text === name,
  );
}

function routePath(opening) {
  const attribute = jsxAttribute(opening, "path");
  return attribute &&
    typescript.isJsxAttribute(attribute) &&
    attribute.initializer &&
    typescript.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text
    : null;
}

function routeElementName(opening) {
  const attribute = jsxAttribute(opening, "element");
  if (!attribute || !typescript.isJsxAttribute(attribute) || !attribute.initializer || !typescript.isJsxExpression(attribute.initializer)) {
    return null;
  }
  const expression = attribute.initializer.expression;
  if (typescript.isJsxSelfClosingElement(expression)) return tagName(expression.tagName);
  if (typescript.isJsxElement(expression)) return tagName(expression.openingElement.tagName);
  return null;
}

function isIndexRoute(opening) {
  return Boolean(jsxAttribute(opening, "index"));
}

const appFile = sourceFile(appPath, appSource);
const parentShellRoutes = findNodes(appFile, (node) =>
  typescript.isJsxElement(node) &&
  tagName(node.openingElement.tagName) === "Route" &&
  routePath(node.openingElement) === null &&
  routeElementName(node.openingElement) === "AppLayout",
);
assert.equal(parentShellRoutes.length, 1, "exactly one pathless AppLayout route shell is required");

const routesContainers = findNodes(appFile, (node) =>
  typescript.isJsxElement(node) && tagName(node.openingElement.tagName) === "Routes",
);
assert.equal(routesContainers.length, 1, "App must retain one top-level Routes container");
const topLevelRoutes = routesContainers[0].children.filter((child) =>
  (typescript.isJsxElement(child) || typescript.isJsxSelfClosingElement(child)) &&
  tagName(typescript.isJsxElement(child) ? child.openingElement.tagName : child.tagName) === "Route",
);
assert.equal(topLevelRoutes.length, 3, "auth, the shared shell, and the catch-all must remain sibling routes");
assert.ok(topLevelRoutes.includes(parentShellRoutes[0]), "the shared shell must be a direct Routes child");
const topLevelRouteByPath = new Map(
  topLevelRoutes
    .filter((route) => route !== parentShellRoutes[0])
    .map((route) => [routePath(typescript.isJsxElement(route) ? route.openingElement : route), route]),
);
for (const [path, element] of [["/auth", "AuthPage"], ["*", "NotFound"]]) {
  const route = topLevelRouteByPath.get(path);
  assert.ok(route, `${path} must remain outside the protected AppLayout shell`);
  assert.equal(
    routeElementName(typescript.isJsxElement(route) ? route.openingElement : route),
    element,
    `${path} must preserve its top-level page mapping`,
  );
}

const protectedRoutes = parentShellRoutes[0].children.filter((child) =>
  typescript.isJsxSelfClosingElement(child) && tagName(child.tagName) === "Route",
);
const expectedRoutes = new Map([
  ["index", "Dashboard"],
  ["monitoring", "Monitoring"],
  ["video-renders", "VideoRenders"],
  ["threads", "Threads"],
  ["x-account", "XAccountDisabled"],
  ["downloader", "Downloader"],
  ["settings", "Settings"],
]);
assert.equal(protectedRoutes.length, expectedRoutes.size, "all protected routes must be direct children of the one stable shell");
for (const route of protectedRoutes) {
  const path = isIndexRoute(route) ? "index" : routePath(route);
  assert.ok(path && expectedRoutes.has(path), `unexpected protected route ${path ?? "<missing>"}`);
  assert.equal(routeElementName(route), expectedRoutes.get(path), `protected route ${path} must preserve its page mapping`);
}
assert.equal(
  findNodes(appFile, (node) =>
    (typescript.isJsxElement(node) && tagName(node.openingElement.tagName) === "AppLayout") ||
    (typescript.isJsxSelfClosingElement(node) && tagName(node.tagName) === "AppLayout"),
  ).length,
  1,
  "App must render AppLayout once as the shared shell",
);

const layoutFile = sourceFile(layoutPath, layoutSource);
assert.ok(
  layoutSource.includes("Outlet"),
  "AppLayout must import and retain the router Outlet fallback",
);
assert.equal(
  findNodes(layoutFile, (node) =>
    typescript.isJsxSelfClosingElement(node) && tagName(node.tagName) === "Outlet",
  ).length,
  1,
  "AppLayout must render one Outlet fallback for nested routes",
);
assert.match(layoutSource, /children\?\s*:\s*ReactNode/, "AppLayout children must remain optional for nested routing");
assert.match(layoutSource, /children\s*\?\?\s*<Outlet\s*\/>/, "AppLayout must preserve direct children before falling back to Outlet");
assert.match(layoutTestSource, /<AppLayout>\s*<div>Page content<\/div>\s*<\/AppLayout>/, "AppLayout direct-child test fixture must remain covered");
assert.match(layoutTestSource, /expect\(screen\.getByText\("Page content"\)\)\.toBeInTheDocument\(\)/, "direct-child fixture must assert rendered content");
assert.match(layoutTestSource, /<Route element=\{<AppLayout\s*\/>\}>\s*<Route index element=\{<div>Nested outlet content<\/div>\}\s*\/>\s*<\/Route>/, "AppLayout nested-outlet test fixture must remain covered");
assert.match(layoutTestSource, /expect\(screen\.getByText\("Nested outlet content"\)\)\.toBeInTheDocument\(\)/, "nested-outlet fixture must assert rendered content");

console.log(`STABLE_ROUTE_SHELL_SOURCE_CONTRACT_PASS routes=${expectedRoutes.size} shells=${parentShellRoutes.length}`);
