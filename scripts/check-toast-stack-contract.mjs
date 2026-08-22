import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "src");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const removedPackages = ["sonner", "next-themes"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) return walk(filePath);
    return sourceExtensions.has(extname(entry.name)) ? [filePath] : [];
  });
}

const sourceFiles = walk(sourceRoot);
const sourceReferences = sourceFiles.flatMap((filePath) => {
  const source = readFileSync(filePath, "utf8");
  return removedPackages
    .filter((packageName) => source.includes(packageName))
    .map((packageName) => ({ filePath, packageName }));
});

assert(
  sourceReferences.length === 0,
  `Removed toast dependencies still referenced: ${sourceReferences.map(({ filePath, packageName }) => `${filePath} -> ${packageName}`).join(", ")}`,
);

const appPath = join(root, "src/App.tsx");
const appSource = readFileSync(appPath, "utf8");
assert(
  appSource.includes('import { Toaster } from "@/components/ui/toaster";'),
  "App must retain the Radix Toaster import",
);
assert(!appSource.includes("components/ui/sonner"), "App must not import Sonner");
assert(!appSource.includes("<Sonner"), "App must not mount Sonner");
assert(
  (appSource.match(/<Toaster\s*\/>/g) ?? []).length === 1,
  "App must mount exactly one retained Toaster",
);

const retainedToasterPath = join(root, "src/components/ui/toaster.tsx");
const retainedToaster = readFileSync(retainedToasterPath, "utf8");
assert(
  retainedToaster.includes('import { useToast } from "@/hooks/use-toast"'),
  "Retained Toaster must use the existing useToast state",
);
assert(
  !existsSync(join(root, "src/components/ui/sonner.tsx")),
  "Unused Sonner wrapper must be removed",
);

const toastHookModules = sourceFiles.filter((filePath) =>
  readFileSync(filePath, "utf8").includes("@/hooks/use-toast")
);
assert(toastHookModules.length > 1, "Expected active useToast caller modules");

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
assert(packageLock.lockfileVersion === 3, "Expected package-lock v3");

for (const packageName of removedPackages) {
  assert(
    !Object.hasOwn(packageJson.dependencies ?? {}, packageName),
    `package.json still declares ${packageName}`,
  );
  assert(
    !Object.hasOwn(packageLock.packages?.[""]?.dependencies ?? {}, packageName),
    `package-lock root still declares ${packageName}`,
  );
  assert(
    !Object.hasOwn(packageLock.packages ?? {}, `node_modules/${packageName}`),
    `package-lock still contains node_modules/${packageName}`,
  );
  const directDependents = Object.entries(packageLock.packages ?? {}).filter(
    ([packagePath, packageMetadata]) =>
      packagePath !== "" &&
      (
        packageMetadata.dependencies?.[packageName] ||
        packageMetadata.optionalDependencies?.[packageName] ||
        packageMetadata.peerDependencies?.[packageName]
      ),
  );
  assert(
    directDependents.length === 0,
    `${packageName} still has direct lockfile dependents: ${directDependents.map(([packagePath]) => packagePath).join(", ")}`,
  );
}

console.log(
  `TOAST_STACK_SOURCE_CONTRACT_PASS 15 useToastModules=${toastHookModules.length}`,
);
