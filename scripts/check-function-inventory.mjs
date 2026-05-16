import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const functionsDir = "supabase/functions";
const config = readFileSync("supabase/config.toml", "utf8");

const localFunctions = readdirSync(functionsDir)
  .filter((name) => name !== "_shared")
  .filter((name) => statSync(join(functionsDir, name)).isDirectory())
  .sort();

const configuredFunctions = [...config.matchAll(/^\[functions\.([^\]]+)\]/gm)]
  .map((match) => match[1])
  .sort();

const missingConfig = localFunctions.filter((name) => !configuredFunctions.includes(name));
const staleConfig = configuredFunctions.filter((name) => !localFunctions.includes(name));

if (missingConfig.length || staleConfig.length) {
  if (missingConfig.length) {
    console.error(`Missing Supabase function config: ${missingConfig.join(", ")}`);
  }
  if (staleConfig.length) {
    console.error(`Stale Supabase function config: ${staleConfig.join(", ")}`);
  }
  process.exit(1);
}

console.log(`Supabase function inventory OK: ${localFunctions.length} functions`);
