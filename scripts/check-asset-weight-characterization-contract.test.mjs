import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createVp8Payload,
  createVp8xPayload,
  createWebpChunk,
  createWebpFixture,
  parseWebp,
  runContainerMutationTests,
  runMutationTests,
  validate,
} from "./check-asset-weight-characterization-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fullPath = join(ROOT, "public/xot-logo-full.webp");
const compactPath = join(ROOT, "public/xot-logo-compact.webp");
const fullWebp = readFileSync(fullPath);
const compactWebp = readFileSync(compactPath);

test("final full and compact derivatives parse as alpha VP8L at reviewed dimensions", () => {
  assert.deepEqual(parseWebp(fullWebp, fullPath), {
    width: 320,
    height: 320,
    hasAlpha: true,
    kind: "VP8L",
  });
  assert.deepEqual(parseWebp(compactWebp, compactPath), {
    width: 64,
    height: 64,
    hasAlpha: true,
    kind: "VP8L",
  });
});

test("valid VP8X plus ALPH plus VP8 lossy structure parses with alpha", () => {
  const fixture = createWebpFixture([
    createWebpChunk("VP8X", createVp8xPayload(32, 24, true)),
    createWebpChunk("ALPH", Buffer.from([0])),
    createWebpChunk("VP8 ", createVp8Payload(32, 24)),
  ]);
  assert.deepEqual(parseWebp(fixture, "valid-lossy.webp"), {
    width: 32,
    height: 24,
    hasAlpha: true,
    kind: "VP8",
  });
});

test("VP8X container reviewer probes and malformed variants fail closed", () => {
  assert.doesNotThrow(() => runContainerMutationTests());
});

test("wrong VP8L width and height mutations are observable and rejected", () => {
  const mutated = Buffer.from(fullWebp);
  const header = mutated.readUInt32LE(21);
  mutated.writeUInt32LE((header & ~0x0fffffff) | 318 | (319 << 14), 21);
  const parsed = parseWebp(mutated, "wrong-geometry.webp");
  assert.equal(parsed.width, 319);
  assert.equal(parsed.height, 320);
  assert.throws(() => validate(ROOT, { "public/xot-logo-full.webp": mutated }), /reviewed SHA-256/);
});

test("VP8L alpha-bit false mutation is observable and rejected", () => {
  const mutated = Buffer.from(compactWebp);
  mutated.writeUInt32LE(mutated.readUInt32LE(21) & ~0x10000000, 21);
  assert.equal(parseWebp(mutated, "no-alpha.webp").hasAlpha, false);
  assert.throws(() => validate(ROOT, { "public/xot-logo-compact.webp": mutated }), /reviewed SHA-256/);
});

test("final full and compact SHA mutations are rejected at unchanged dimensions", () => {
  const fullMutation = Buffer.from(fullWebp);
  fullMutation[fullMutation.length - 1] ^= 0xff;
  const compactMutation = Buffer.from(compactWebp);
  compactMutation[compactMutation.length - 1] ^= 0xff;
  assert.throws(() => validate(ROOT, { "public/xot-logo-full.webp": fullMutation }), /reviewed SHA-256/);
  assert.throws(() => validate(ROOT, { "public/xot-logo-compact.webp": compactMutation }), /reviewed SHA-256/);
});

test("missing, empty, and heavy asset mutations are rejected", () => {
  assert.throws(() => validate(ROOT, { "public/xot-logo.png": Buffer.alloc(0) }), /reviewed byte size/);
  assert.throws(() => validate(ROOT, {
    "public/xot-logo-full.webp": Buffer.concat([fullWebp, Buffer.alloc(89_572)]),
  }), /reviewed byte size/);
  assert.throws(() => validate(ROOT, {
    "public/xot-logo-compact.webp": Buffer.alloc(0),
  }), /reviewed byte size/);
});

test("brand references and metadata fallbacks are fail-closed", () => {
  const brandLogo = readFileSync(join(ROOT, "src/components/layout/BrandLogo.tsx"), "utf8");
  const index = readFileSync(join(ROOT, "index.html"), "utf8");
  assert.throws(() => validate(ROOT, {
    "src/components/layout/BrandLogo.tsx": brandLogo.replace("/xot-logo-full.webp", "/missing-logo.webp"),
  }), /must retain the \/xot-logo-full\.webp asset reference/);
  assert.throws(() => validate(ROOT, {
    "index.html": index.replace("/apple-touch-icon.png", "/missing-icon.png"),
  }), /must retain the \/apple-touch-icon\.png asset reference/);
});

test("source-content mismatch rejects deterministic source linkage", () => {
  const changedFullSource = readFileSync(join(ROOT, "public/xot-logo.png"));
  changedFullSource[changedFullSource.length - 1] ^= 0xff;
  const changedCompactSource = readFileSync(join(ROOT, "public/favicon.png"));
  changedCompactSource[changedCompactSource.length - 1] ^= 0xff;
  assert.throws(() => validate(ROOT, { "public/xot-logo.png": changedFullSource }), /reviewed SHA-256/);
  assert.throws(() => validate(ROOT, { "public/favicon.png": changedCompactSource }), /reviewed SHA-256/);
});

test("malformed RIFF, chunk, VP8L signature, version, and type fail closed", () => {
  const malformedRiff = Buffer.from(fullWebp);
  malformedRiff.writeUInt32LE(malformedRiff.length, 4);
  assert.throws(() => parseWebp(malformedRiff, "malformed-riff.webp"), /RIFF length/);

  const malformedChunk = Buffer.from(fullWebp);
  malformedChunk.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => parseWebp(malformedChunk, "malformed-chunk.webp"), /beyond the RIFF boundary/);

  const malformedSignature = Buffer.from(fullWebp);
  malformedSignature[20] = 0;
  assert.throws(() => parseWebp(malformedSignature, "malformed-signature.webp"), /invalid VP8L signature/);

  const malformedVersion = Buffer.from(fullWebp);
  malformedVersion.writeUInt32LE(malformedVersion.readUInt32LE(21) | (1 << 29), 21);
  assert.throws(() => parseWebp(malformedVersion, "malformed-version.webp"), /unsupported VP8L version/);

  const malformedType = Buffer.from(fullWebp);
  malformedType.write("BAD!", 12, "ascii");
  assert.throws(() => parseWebp(malformedType, "malformed-type.webp"), /unsupported WebP chunk type/);
});

test("checker mutation harness exercises every fail-closed mutation", () => {
  assert.doesNotThrow(() => runMutationTests());
});
