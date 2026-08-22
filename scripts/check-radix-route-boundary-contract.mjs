import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appPath = join(repoRoot, "src/App.tsx");
const dashboardPath = join(repoRoot, "src/pages/Dashboard.tsx");
const require = createRequire(import.meta.url);
const typescript = require("typescript");

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

function jsxTagNodes(root, name) {
  return findNodes(root, (node) =>
    (typescript.isJsxElement(node) && tagName(node.openingElement.tagName) === name)
    || (typescript.isJsxSelfClosingElement(node) && tagName(node.tagName) === name),
  );
}

function importFrom(root, moduleName, importedName) {
  return findNodes(root, (node) => {
    if (!typescript.isImportDeclaration(node) || !node.importClause || !node.moduleSpecifier) return false;
    if (node.moduleSpecifier.text !== moduleName) return false;
    const bindings = node.importClause.namedBindings;
    return typescript.isNamedImports(bindings)
      && bindings.elements.some((element) => element.name.text === importedName);
  });
}

function returnedJsxExpressions(functionNode) {
  const found = [];
  const visit = (node) => {
    if (typescript.isFunctionDeclaration(node) || typescript.isFunctionExpression(node) || typescript.isArrowFunction(node)) return;
    if (typescript.isReturnStatement(node) && node.expression) {
      let expression = node.expression;
      while (typescript.isParenthesizedExpression(expression)) expression = expression.expression;
      if (typescript.isJsxElement(expression) || typescript.isJsxSelfClosingElement(expression)) {
        found.push(expression);
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(functionNode.body);
  return found;
}

function validate(appSource, dashboardSource) {
  const appFile = sourceFile(appPath, appSource);
  const dashboardFile = sourceFile(dashboardPath, dashboardSource);
  const errors = [];

  if (importFrom(appFile, "@/components/ui/tooltip", "TooltipProvider").length > 0) {
    errors.push("App must not import TooltipProvider into the global shell");
  }
  if (jsxTagNodes(appFile, "TooltipProvider").length > 0) {
    errors.push("App must not mount TooltipProvider around auth or catch-all routes");
  }

  if (importFrom(dashboardFile, "@/components/ui/tooltip", "TooltipProvider").length !== 1) {
    errors.push("Dashboard must own the TooltipProvider import");
  }
  if (jsxTagNodes(dashboardFile, "TooltipProvider").length !== 1) {
    errors.push("Dashboard must mount exactly one TooltipProvider");
  }
  const dashboardFunctions = findNodes(dashboardFile, (node) =>
    typescript.isFunctionDeclaration(node) && node.name?.text === "Dashboard",
  );
  if (dashboardFunctions.length !== 1) {
    errors.push("Dashboard must have exactly one exported wrapper function");
  } else {
    const returns = returnedJsxExpressions(dashboardFunctions[0]);
    if (returns.length !== 1 || !typescript.isJsxElement(returns[0]) || tagName(returns[0].openingElement.tagName) !== "TooltipProvider") {
      errors.push("Dashboard wrapper must return exactly one TooltipProvider root");
    } else {
      const children = returns[0].children.filter((child) =>
        typescript.isJsxElement(child) || typescript.isJsxSelfClosingElement(child),
      );
      if (children.length !== 1 || !typescript.isJsxSelfClosingElement(children[0]) || tagName(children[0].tagName) !== "DashboardContent") {
        errors.push("TooltipProvider must wrap DashboardContent directly");
      }
    }
  }

  const metricHelpFunctions = findNodes(dashboardFile, (node) =>
    typescript.isFunctionDeclaration(node) && node.name?.text === "MetricHelp",
  );
  if (metricHelpFunctions.length !== 1 || jsxTagNodes(metricHelpFunctions[0], "Tooltip").length === 0) {
    errors.push("Dashboard must retain the MetricHelp tooltip usage");
  }

  assert.equal(errors.length, 0, errors.join("; "));
  return { provider: "Dashboard", globalProvider: "absent", tooltipUsage: "retained" };
}

const appSource = readFileSync(appPath, "utf8");
const dashboardSource = readFileSync(dashboardPath, "utf8");
validate(appSource, dashboardSource);

if (process.env.MUTATION_TEST === "1") {
  assert.throws(
    () => validate(`${appSource}\n<TooltipProvider />`, dashboardSource),
    /App must not mount TooltipProvider/,
    "global TooltipProvider mutation must fail the contract",
  );
  assert.throws(
    () => validate(appSource, dashboardSource.replace("<TooltipProvider>\n      <DashboardContent />\n    </TooltipProvider>", "<DashboardContent />")),
    /Dashboard wrapper must return exactly one TooltipProvider root/,
    "Dashboard provider removal mutation must fail the contract",
  );
  console.log("RADIX_ROUTE_BOUNDARY_SOURCE_CONTRACT_PASS mutation=pass");
} else {
  console.log("RADIX_ROUTE_BOUNDARY_SOURCE_CONTRACT_PASS provider=Dashboard globalProvider=absent tooltipUsage=retained");
}
