import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  getPayloadTweetId,
  jobReferenceValues,
  tweetReferenceVariants,
} from "../../supabase/functions/admin-actions/tweetReferences";

const repoRoot = resolve(import.meta.dirname, "../..");
const readHelpersPath = resolve(repoRoot, "supabase/functions/admin-actions/readHelpers.ts");
const tweetReferencesPath = resolve(repoRoot, "supabase/functions/admin-actions/tweetReferences.ts");

const declarationHashes = {
  getPayloadTweetId: "fff361dbe53dd695e0c5dc1b683de805118b0151853bcba9dbc377d55d5a8412",
  tweetReferenceVariants: "a60c9ebc21f03a7438becb815b69b7c65b626a05e51123e66687fbd5ca9f314a",
  jobReferenceValues: "9a617ca1751d14debdb2e34b8a58ec27c17cd42c25541a307ec505bfc1c09849",
};

const historicalDeclarations = {
  getPayloadTweetId: `export function getPayloadTweetId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = (payload as Record<string, unknown>).tweet_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}`,
  tweetReferenceVariants: [
    "export function tweetReferenceVariants(value: unknown): string[] {",
    "  if (typeof value !== \"string\" || !value.trim()) return [];",
    "  const raw = value.trim();",
    "  const variants = new Set<string>([raw]);",
    "  const statusMatch = raw.match(/(?:status|statuses)\\/(\\d{5,})/);",
    "  const numeric = statusMatch?.[1] ?? (/^\\d{5,}$/.test(raw) ? raw : null);",
    "  if (numeric) {",
    "    variants.add(numeric);",
    "    variants.add(`https://twitter.com/i/status/${numeric}`);",
    "    variants.add(`https://twitter.com/status/${numeric}`);",
    "    variants.add(`https://x.com/i/status/${numeric}`);",
    "    variants.add(`https://x.com/status/${numeric}`);",
    "  }",
    "  return [...variants];",
    "}",
  ].join("\n"),
  jobReferenceValues: [
    "export function jobReferenceValues(row: Record<string, unknown>): string[] {",
    "  const values = new Set<string>();",
    "  const payload = row.payload && typeof row.payload === \"object\" ? row.payload as Record<string, unknown> : {};",
    "  for (const key of [\"tweet_id\", \"target_tweet_id\", \"post_id\", \"url\", \"src_url\"]) {",
    "    const value = payload[key];",
    "    if (typeof value === \"string\" && value.trim()) {",
    "      tweetReferenceVariants(value).forEach((variant) => values.add(variant));",
    "    }",
    "  }",
    "  const idempotency = typeof row.idempotency_key === \"string\" ? row.idempotency_key : \"\";",
    "  const statusMatch = idempotency.match(/(?:status|statuses)\\/(\\d{5,})/);",
    "  const numericMatch = idempotency.match(/(^|[:/])(\\d{10,})(?=[:/]|$)/);",
    "  const numeric = statusMatch?.[1] ?? numericMatch?.[2] ?? null;",
    "  if (numeric) tweetReferenceVariants(numeric).forEach((variant) => values.add(variant));",
    "  return [...values];",
    "}",
  ].join("\n"),
};

const historicalDeclarationBlock = [
  historicalDeclarations.getPayloadTweetId,
  historicalDeclarations.tweetReferenceVariants,
  historicalDeclarations.jobReferenceValues,
].join("\n\n");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceFile(path: string, source: string): ts.SourceFile {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function declarations(path: string, source: string) {
  const file = sourceFile(path, source);
  return file.statements.filter((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && Boolean(statement.name)
  );
}

function declarationText(path: string, source: string, name: string): string {
  const file = sourceFile(path, source);
  const declaration = declarations(path, source).find((statement) => statement.name?.text === name);
  expect(declaration, `expected ${name} declaration in ${path}`).toBeDefined();
  return source.slice(declaration!.getStart(file), declaration!.end);
}

function hasNamedExport(source: string, name: string, modulePath: string): boolean {
  return new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']${modulePath.replace(".", "\\.")}\\.ts["']`).test(source);
}

function architectureContract(readHelpers: string, tweetReferences: string): void {
  const names = Object.keys(declarationHashes);
  const moduleDeclarations = declarations(tweetReferencesPath, tweetReferences);
  const helperDeclarations = declarations(readHelpersPath, readHelpers);

  for (const name of names) {
    expect(sha256(declarationText(tweetReferencesPath, tweetReferences, name))).toBe(declarationHashes[name as keyof typeof declarationHashes]);
    expect(sha256(historicalDeclarations[name as keyof typeof historicalDeclarations])).toBe(declarationHashes[name as keyof typeof declarationHashes]);
    expect(moduleDeclarations.filter((statement) => statement.name?.text === name)).toHaveLength(1);
    expect(helperDeclarations.filter((statement) => statement.name?.text === name)).toHaveLength(0);
    expect(hasNamedExport(readHelpers, name, "./tweetReferences")).toBe(true);
  }

  expect(tweetReferences).not.toContain("from \"./types.ts\"");
  expect(tweetReferences).toContain("export function getPayloadTweetId");
  expect(readHelpers).toContain('export { getPayloadTweetId, jobReferenceValues, tweetReferenceVariants } from "./tweetReferences.ts";');
  expect(readHelpers).toContain('import { getPayloadTweetId, jobReferenceValues, tweetReferenceVariants } from "./tweetReferences.ts";');
  expect(readHelpers).toContain("export async function loadPostsByJobReferences");
  expect(sha256(declarationText(readHelpersPath, readHelpers, "loadPostsByJobReferences"))).toBe(
    "2b316f8f20f8e4221175f828652199cab8c7e086b654927471d252cc6a3a9ca5",
  );
}

describe("admin tweet reference pure module", () => {
  it("normalizes payloads and preserves deterministic URL expansion order", () => {
    expect(getPayloadTweetId({ tweet_id: "  1234567890  " })).toBe("1234567890");
    expect(getPayloadTweetId({ tweet_id: "   " })).toBeNull();
    expect(getPayloadTweetId(null)).toBeNull();
    expect(tweetReferenceVariants("https://x.com/status/1234567890")).toEqual([
      "https://x.com/status/1234567890",
      "1234567890",
      "https://twitter.com/i/status/1234567890",
      "https://twitter.com/status/1234567890",
      "https://x.com/i/status/1234567890",
    ]);
    expect(tweetReferenceVariants("1234567890")).toHaveLength(5);
    expect(tweetReferenceVariants("not-a-tweet-id")).toEqual(["not-a-tweet-id"]);
    expect(tweetReferenceVariants(1234567890)).toEqual([]);
  });

  it("collects nested payload references and deduplicates while preserving first-seen order", () => {
    expect(jobReferenceValues({
      payload: {
        tweet_id: "1111111111",
        target_tweet_id: "1111111111",
        post_id: "https://x.com/status/2222222222",
        url: "https://twitter.com/status/2222222222",
        src_url: "https://x.com/status/3333333333",
      },
      idempotency_key: "deliver:statuses/4444444444",
    })).toEqual([
      "1111111111",
      "https://twitter.com/i/status/1111111111",
      "https://twitter.com/status/1111111111",
      "https://x.com/i/status/1111111111",
      "https://x.com/status/1111111111",
      "https://x.com/status/2222222222",
      "2222222222",
      "https://twitter.com/i/status/2222222222",
      "https://twitter.com/status/2222222222",
      "https://x.com/i/status/2222222222",
      "https://x.com/status/3333333333",
      "3333333333",
      "https://twitter.com/i/status/3333333333",
      "https://twitter.com/status/3333333333",
      "https://x.com/i/status/3333333333",
      "4444444444",
      "https://twitter.com/i/status/4444444444",
      "https://twitter.com/status/4444444444",
      "https://x.com/i/status/4444444444",
      "https://x.com/status/4444444444",
    ]);
  });

  it("keeps the source-side contract bounded to ten thousand jobs", () => {
    const source = readFileSync(readHelpersPath, "utf8");
    expect(source).toContain(".slice(0, 10000)");
  });

  it("proves the extracted architecture and exact inverse reconstruction", () => {
    const tweetReferences = readFileSync(tweetReferencesPath, "utf8");
    const readHelpers = readFileSync(readHelpersPath, "utf8");
    architectureContract(readHelpers, tweetReferences);

    const extractedBlock = [
      declarationText(tweetReferencesPath, tweetReferences, "getPayloadTweetId"),
      declarationText(tweetReferencesPath, tweetReferences, "tweetReferenceVariants"),
      declarationText(tweetReferencesPath, tweetReferences, "jobReferenceValues"),
    ].join("\n\n");
    expect(sha256(`${extractedBlock}\n`)).toBe("e6348347f1416891a74126d3b8702bd1f110071f7b7a3b46fb652a5395006ce6");
    expect(sha256(`${historicalDeclarationBlock}\n`)).toBe("e6348347f1416891a74126d3b8702bd1f110071f7b7a3b46fb652a5395006ce6");
    expect(extractedBlock).toBe(historicalDeclarationBlock);

    const reconstructed = readHelpers.replace(
      'import { getPayloadTweetId, jobReferenceValues, tweetReferenceVariants } from "./tweetReferences.ts";\nexport { getPayloadTweetId, jobReferenceValues, tweetReferenceVariants } from "./tweetReferences.ts";\n',
      `\n${historicalDeclarationBlock}\n`,
    );
    expect(sha256(reconstructed)).toBe("1951c17397b37ca1eb383c901d1ccd6f296531f2a281c34ec6441a446077ddf3");
    expect(Buffer.byteLength(reconstructed)).toBe(5616);
    expect(reconstructed.split("\n").length - 1).toBe(131);

    for (const path of [tweetReferencesPath, readHelpersPath]) {
      const source = readFileSync(path, "utf8");
      expect(source.includes("\r")).toBe(false);
      expect(source.endsWith("\n")).toBe(true);
      expect(source.endsWith("\n\n")).toBe(false);
      expect(source).not.toMatch(/[ \\t]+\n/);
    }
  });

  it("fails closed when the module contract is mutated", () => {
    const tweetReferences = readFileSync(tweetReferencesPath, "utf8");
    const readHelpers = readFileSync(readHelpersPath, "utf8");
    const bodyMutation = tweetReferences.replace("return null;", "return \"mutated\";");
    const missingReExport = readHelpers.replace("getPayloadTweetId, ", "");
    const duplicateImplementation = `${tweetReferences}\nexport function getPayloadTweetId(payload: unknown): string | null { return null; }\n`;

    expect(() => architectureContract(readHelpers, bodyMutation)).toThrow();
    expect(() => expect(
      [
        declarationText(tweetReferencesPath, bodyMutation, "getPayloadTweetId"),
        declarationText(tweetReferencesPath, bodyMutation, "tweetReferenceVariants"),
        declarationText(tweetReferencesPath, bodyMutation, "jobReferenceValues"),
      ].join("\n\n"),
    ).toBe(historicalDeclarationBlock)).toThrow();
    expect(() => architectureContract(missingReExport, tweetReferences)).toThrow();
    expect(() => architectureContract(readHelpers, duplicateImplementation)).toThrow();
  });

});
