import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

// Derivatives are generated from the byte-pinned originals with cwebp 1.6.0:
// cwebp -quiet -m 6 -lossless -resize 320 320 public/xot-logo.png -o public/xot-logo-full.webp
// cwebp -quiet -m 6 -lossless -resize 64 64 public/favicon.png -o public/xot-logo-compact.webp
const ORIGINAL_ASSETS = [
  {
    path: "public/xot-logo.png",
    label: "full-logo",
    format: "png",
    width: 1200,
    height: 1200,
    bytes: 179_143,
    sha256: "9fa84c5d71ce0923cb656368a98e5304a93ec264aa87cd537cea559a1fe380e0",
    reviewThresholdBytes: 150_000,
  },
  {
    path: "public/favicon.png",
    label: "compact-logo",
    format: "png",
    width: 512,
    height: 512,
    bytes: 54_858,
    sha256: "d8d856631b7f8c25f86f43c16335b1b07c9d0d13a243a72e38654455a6bbbe90",
    reviewThresholdBytes: 50_000,
  },
  {
    path: "public/apple-touch-icon.png",
    label: "apple-touch-icon",
    format: "png",
    width: 180,
    height: 180,
    bytes: 12_327,
    sha256: "e971b79475d954f204356f9a979c4307f87b1206f2b1cf7df6a71d936d09ed89",
    reviewThresholdBytes: 20_000,
  },
];

const DERIVATIVE_ASSETS = [
  {
    path: "public/xot-logo-full.webp",
    label: "full-logo-webp",
    format: "webp",
    width: 320,
    height: 320,
    sourcePath: "public/xot-logo.png",
    sourceSha256: ORIGINAL_ASSETS[0].sha256,
    maxBytes: 89_571,
    bytes: 14_086,
    sha256: "ff3627016536f5f08adc51f35fafbaddb7dd3c6661ad3ca69bbde7c154abe7c2",
  },
  {
    path: "public/xot-logo-compact.webp",
    label: "compact-logo-webp",
    format: "webp",
    width: 64,
    height: 64,
    sourcePath: "public/favicon.png",
    sourceSha256: ORIGINAL_ASSETS[1].sha256,
    maxBytes: 27_429,
    bytes: 2_186,
    sha256: "f633e0d7b9576a7285ced8494fd6fa6415df5c76608b6a14365ae3c44a122629",
  },
];

const ASSET_FILES = [...ORIGINAL_ASSETS, ...DERIVATIVE_ASSETS];

const SOURCE_FILES = [
  "src/components/layout/BrandLogo.tsx",
  "src/pages/AuthPage.tsx",
  "index.html",
];

const REVIEWED_ASSET_MANIFEST = [
  "public/xot-logo.png",
  "public/favicon.png",
  "public/apple-touch-icon.png",
  "public/xot-logo-full.webp",
  "public/xot-logo-compact.webp",
];
const REVIEWED_SOURCE_MANIFEST = [
  "src/components/layout/BrandLogo.tsx",
  "src/pages/AuthPage.tsx",
  "index.html",
];

const REQUIRED_REFERENCES = [
  ["src/components/layout/BrandLogo.tsx", "/xot-logo.png"],
  ["src/components/layout/BrandLogo.tsx", "/favicon.png"],
  ["src/components/layout/BrandLogo.tsx", "/xot-logo-full.webp"],
  ["src/components/layout/BrandLogo.tsx", "/xot-logo-compact.webp"],
  ["src/pages/AuthPage.tsx", "@/components/layout/BrandLogo"],
  ["index.html", "/favicon.png"],
  ["index.html", "/apple-touch-icon.png"],
  ["index.html", "/xot-logo.png"],
];

function readOverrideOrFile(root, relativePath, overrides) {
  if (Object.prototype.hasOwnProperty.call(overrides, relativePath)) return overrides[relativePath];
  return readFileSync(join(root, relativePath));
}

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parsePng(bytes, path) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path} must be a PNG`);
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR", `${path} must contain an IHDR chunk`);
  assert.ok(bytes.length >= 26, `${path} must include PNG dimensions and color type`);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    hasAlpha: bytes[25] === 4 || bytes[25] === 6,
  };
}

function parseWebp(bytes, path) {
  assert.ok(bytes.length >= 12, `${path} must include a complete RIFF header`);
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF", `${path} must be a RIFF WebP`);
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, `${path} RIFF length must match the file`);
  assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP", `${path} must be a WebP`);

  let image = null;
  let extended = null;
  let alphaChunk = false;
  let seenChunk = false;
  let offset = 12;
  while (offset < bytes.length) {
    assert.ok(offset + 8 <= bytes.length, `${path} has a truncated WebP chunk header`);
    const chunkType = bytes.toString("ascii", offset, offset + 4);
    const chunkBytes = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkBytes;
    assert.ok(chunkEnd >= chunkStart && chunkEnd <= bytes.length, `${path} has a chunk beyond the RIFF boundary`);
    const nextOffset = chunkEnd + (chunkBytes % 2);
    assert.ok(nextOffset <= bytes.length, `${path} has a truncated WebP chunk pad`);

    if (chunkType === "VP8X") {
      assert.equal(seenChunk, false, `${path} VP8X must be the first chunk`);
      assert.equal(extended, null, `${path} must not contain duplicate VP8X chunks`);
      assert.ok(chunkBytes >= 10, `${path} must have a valid VP8X header`);
      assert.equal(bytes[chunkStart] & 0xe0, 0, `${path} has invalid reserved VP8X flags`);
      extended = {
        width: 1 + bytes.readUIntLE(chunkStart + 4, 3),
        height: 1 + bytes.readUIntLE(chunkStart + 7, 3),
        hasAlpha: (bytes[chunkStart] & 0x10) !== 0,
      };
    } else if (chunkType === "VP8L") {
      assert.equal(image, null, `${path} must not contain multiple image chunks`);
      assert.ok(chunkBytes >= 5, `${path} must have a complete VP8L header`);
      assert.equal(bytes[chunkStart], 0x2f, `${path} has an invalid VP8L signature`);
      const header = bytes.readUInt32LE(chunkStart + 1);
      const version = header >>> 29;
      assert.equal(version, 0, `${path} has an unsupported VP8L version`);
      image = {
        width: (header & 0x3fff) + 1,
        height: ((header >>> 14) & 0x3fff) + 1,
        hasAlpha: (header & 0x10000000) !== 0,
        kind: "VP8L",
      };
    } else if (chunkType === "VP8 ") {
      assert.ok(extended, `${path} lossy VP8 data requires a VP8X canvas`);
      assert.equal(image, null, `${path} must not contain multiple image chunks`);
      assert.equal(chunkBytes >= 10, true, `${path} must have a complete VP8 frame header`);
      const frameTag = bytes.readUIntLE(chunkStart, 3);
      assert.equal(frameTag & 1, 0, `${path} VP8 frame must be a key frame`);
      assert.deepEqual(
        [...bytes.subarray(chunkStart + 3, chunkStart + 6)],
        [0x9d, 0x01, 0x2a],
        `${path} must have a valid VP8 key-frame signature`,
      );
      assert.ok(chunkBytes >= 10, `${path} must include VP8 frame dimensions`);
      image = {
        width: bytes.readUInt16LE(chunkStart + 6) & 0x3fff,
        height: bytes.readUInt16LE(chunkStart + 8) & 0x3fff,
        hasAlpha: false,
        kind: "VP8",
      };
    } else if (chunkType === "ALPH") {
      assert.ok(chunkBytes > 0, `${path} must have a non-empty ALPH chunk`);
      assert.ok(extended, `${path} must declare VP8X before ALPH`);
      assert.equal(image, null, `${path} ALPH must precede the VP8 image chunk`);
      assert.equal(extended.hasAlpha, true, `${path} ALPH requires the VP8X alpha flag`);
      assert.equal(alphaChunk, false, `${path} must not contain duplicate ALPH chunks`);
      alphaChunk = true;
    } else {
      assert.fail(`${path} has an unsupported WebP chunk type ${JSON.stringify(chunkType)}`);
    }
    seenChunk = true;
    offset = nextOffset;
  }

  assert.ok(image, `${path} must contain exactly one image-data chunk`);
  if (image && extended) {
    assert.equal(image.width, extended.width, `${path} VP8L and VP8X widths disagree`);
    assert.equal(image.height, extended.height, `${path} VP8L and VP8X heights disagree`);
    if (image.kind === "VP8L") {
      assert.equal(image.hasAlpha, extended.hasAlpha, `${path} VP8L and VP8X alpha flags disagree`);
      assert.equal(alphaChunk, false, `${path} VP8L cannot carry an ALPH chunk`);
    } else {
      assert.equal(alphaChunk, extended.hasAlpha, `${path} VP8X alpha flag and ALPH data disagree`);
    }
  }
  return { ...image, ...(extended ?? {}), hasAlpha: image.hasAlpha || Boolean(alphaChunk) };
}

function createWebpChunk(type, payload) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const chunk = Buffer.alloc(8 + bytes.length + (bytes.length % 2));
  chunk.write(type, 0, "ascii");
  chunk.writeUInt32LE(bytes.length, 4);
  bytes.copy(chunk, 8);
  return chunk;
}

function createVp8xPayload(width, height, hasAlpha = false) {
  const payload = Buffer.alloc(10);
  payload[0] = hasAlpha ? 0x10 : 0;
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return payload;
}

function createVp8Payload(width, height) {
  const payload = Buffer.alloc(10);
  payload[0] = 0x10;
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return payload;
}

function createWebpFixture(chunks) {
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length + 4, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
}

function runContainerMutationTests() {
  const validLossy = createWebpFixture([
    createWebpChunk("VP8X", createVp8xPayload(32, 24, true)),
    createWebpChunk("ALPH", Buffer.from([0])),
    createWebpChunk("VP8 ", createVp8Payload(32, 24)),
  ]);
  assert.deepEqual(parseWebp(validLossy, "valid-lossy.webp"), {
    width: 32,
    height: 24,
    hasAlpha: true,
    kind: "VP8",
  });

  const vp8xOnly = createWebpFixture([createWebpChunk("VP8X", createVp8xPayload(32, 24))]);
  assert.throws(() => parseWebp(vp8xOnly, "vp8x-only.webp"), /exactly one image-data/);
  const alphOnly = createWebpFixture([
    createWebpChunk("VP8X", createVp8xPayload(32, 24, true)),
    createWebpChunk("ALPH", Buffer.from([0])),
  ]);
  assert.throws(() => parseWebp(alphOnly, "alph-only.webp"), /exactly one image-data/);
  const alphWithoutVp8x = createWebpFixture([
    createWebpChunk("ALPH", Buffer.from([0])),
    createWebpChunk("VP8 ", createVp8Payload(32, 24)),
  ]);
  assert.throws(() => parseWebp(alphWithoutVp8x, "alph-without-vp8x.webp"), /must declare VP8X/);

  const invalidOrder = createWebpFixture([
    createWebpChunk("VP8 ", createVp8Payload(32, 24)),
    createWebpChunk("VP8X", createVp8xPayload(32, 24)),
  ]);
  assert.throws(() => parseWebp(invalidOrder, "invalid-order.webp"), /requires a VP8X canvas/);
  const duplicateVp8x = createWebpFixture([
    createWebpChunk("VP8X", createVp8xPayload(32, 24)),
    createWebpChunk("VP8X", createVp8xPayload(32, 24)),
    createWebpChunk("VP8 ", createVp8Payload(32, 24)),
  ]);
  assert.throws(() => parseWebp(duplicateVp8x, "duplicate-vp8x.webp"), /VP8X must be the first chunk/);
  const duplicateImage = createWebpFixture([
    createWebpChunk("VP8X", createVp8xPayload(32, 24)),
    createWebpChunk("VP8 ", createVp8Payload(32, 24)),
    createWebpChunk("VP8 ", createVp8Payload(32, 24)),
  ]);
  assert.throws(() => parseWebp(duplicateImage, "duplicate-image.webp"), /multiple image chunks/);

  const dimensionMismatch = createWebpFixture([
    createWebpChunk("VP8X", createVp8xPayload(32, 24)),
    createWebpChunk("VP8 ", createVp8Payload(31, 24)),
  ]);
  assert.throws(() => parseWebp(dimensionMismatch, "dimension-mismatch.webp"), /widths disagree/);
  const alphaMissing = createWebpFixture([
    createWebpChunk("VP8X", createVp8xPayload(32, 24, true)),
    createWebpChunk("VP8 ", createVp8Payload(32, 24)),
  ]);
  assert.throws(() => parseWebp(alphaMissing, "alpha-missing.webp"), /alpha flag and ALPH data disagree/);
  const alphaUnexpected = createWebpFixture([
    createWebpChunk("VP8X", createVp8xPayload(32, 24, false)),
    createWebpChunk("ALPH", Buffer.from([0])),
    createWebpChunk("VP8 ", createVp8Payload(32, 24)),
  ]);
  assert.throws(() => parseWebp(alphaUnexpected, "alpha-unexpected.webp"), /ALPH requires the VP8X alpha flag/);

  const oddLengthVp8 = createWebpFixture([
    createWebpChunk("VP8X", createVp8xPayload(32, 24)),
    createWebpChunk("VP8 ", Buffer.concat([createVp8Payload(32, 24), Buffer.from([0])])),
  ]);
  const malformedPad = oddLengthVp8.subarray(0, oddLengthVp8.length - 1);
  malformedPad.writeUInt32LE(malformedPad.length - 8, 4);
  assert.throws(() => parseWebp(malformedPad, "malformed-pad.webp"), /truncated WebP chunk pad/);
  const malformedLength = Buffer.from(validLossy);
  malformedLength.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => parseWebp(malformedLength, "malformed-length.webp"), /beyond the RIFF boundary/);
  const malformedType = Buffer.from(validLossy);
  malformedType.write("BAD!", 12, "ascii");
  assert.throws(() => parseWebp(malformedType, "malformed-type.webp"), /unsupported WebP chunk type/);
}

function validate(root = ROOT, overrides = {}) {
  const sources = Object.fromEntries(SOURCE_FILES.map((relativePath) => [
    relativePath,
    String(readOverrideOrFile(root, relativePath, overrides) ?? ""),
  ]));

  for (const [relativePath, reference] of REQUIRED_REFERENCES) {
    assert.match(
      sources[relativePath],
      new RegExp(reference.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")),
      `${relativePath} must retain the ${reference} asset reference`,
    );
  }

  const assets = ASSET_FILES.map((asset) => {
    const bytes = asBuffer(readOverrideOrFile(root, asset.path, overrides));
    assert.equal(bytes.length, asset.bytes, `${asset.path} must remain the reviewed byte size`);
    assert.equal(sha256(bytes), asset.sha256, `${asset.path} must remain the reviewed SHA-256`);
    if (asset.maxBytes !== undefined) {
      assert.ok(bytes.length <= asset.maxBytes, `${asset.path} exceeds its transfer-size budget`);
      assert.ok(bytes.length < asset.maxBytes, `${asset.path} must remain below its transfer-size budget`);
    }
    const geometry = asset.format === "png" ? parsePng(bytes, asset.path) : parseWebp(bytes, asset.path);
    assert.equal(geometry.width, asset.width, `${asset.path} width drifted`);
    assert.equal(geometry.height, asset.height, `${asset.path} height drifted`);
    assert.equal(geometry.hasAlpha, true, `${asset.path} must preserve transparency`);
    if (asset.sourcePath) {
      const source = asBuffer(readOverrideOrFile(root, asset.sourcePath, overrides));
      assert.equal(sha256(source), asset.sourceSha256, `${asset.path} source reference drifted`);
    }
    return {
      path: asset.path,
      label: asset.label,
      bytes: bytes.length,
      reviewSignal: asset.reviewThresholdBytes !== undefined && bytes.length >= asset.reviewThresholdBytes,
    };
  });

  const fullDerivative = assets.find(({ label }) => label === "full-logo-webp");
  const compactDerivative = assets.find(({ label }) => label === "compact-logo-webp");
  const baselineBytes = ORIGINAL_ASSETS[0].bytes + ORIGINAL_ASSETS[1].bytes;
  const deliveredBytes = fullDerivative.bytes + compactDerivative.bytes;
  assert.ok(deliveredBytes < baselineBytes * 0.5, "delivered full and compact brand bytes must be at least 50% below B0");

  return { assets, sources, baselineBytes, deliveredBytes };
}

function assertInventoryManifests() {
  assert.deepEqual(
    ASSET_FILES.map(({ path }) => path).sort(),
    [...REVIEWED_ASSET_MANIFEST].sort(),
    "asset inventory must match the reviewed manifest",
  );
  assert.deepEqual(
    [...SOURCE_FILES].sort(),
    [...REVIEWED_SOURCE_MANIFEST].sort(),
    "asset source inventory must match the reviewed manifest",
  );
}

function runMutationTests() {
  assert.throws(
    () => assert.deepEqual(
      ASSET_FILES.slice(1).map(({ path }) => path).sort(),
      [...REVIEWED_ASSET_MANIFEST].sort(),
      "asset inventory must match the reviewed manifest",
    ),
    /asset inventory must match the reviewed manifest/,
    "asset inventory omission mutation must fail the manifest gate",
  );
  assert.throws(
    () => assert.deepEqual(
      SOURCE_FILES.slice(1).sort(),
      [...REVIEWED_SOURCE_MANIFEST].sort(),
      "asset source inventory must match the reviewed manifest",
    ),
    /asset source inventory must match the reviewed manifest/,
    "asset source omission mutation must fail the manifest gate",
  );

  const fullWebp = readFileSync(join(ROOT, "public/xot-logo-full.webp"));
  const compactWebp = readFileSync(join(ROOT, "public/xot-logo-compact.webp"));
  const wrongDimensions = Buffer.from(fullWebp);
  const wrongDimensionHeader = wrongDimensions.readUInt32LE(21) & ~0x3fff | 318;
  wrongDimensions.writeUInt32LE(wrongDimensionHeader, 21);
  assert.equal(parseWebp(wrongDimensions, "mutated-full.webp").width, 319, "wrong width mutation must be observable");
  assert.throws(
    () => validate(ROOT, { "public/xot-logo-full.webp": wrongDimensions }),
    /reviewed SHA-256/,
    "wrong dimension mutation must fail the exact derivative hash",
  );

  const alphaFalse = Buffer.from(compactWebp);
  const alphaHeader = alphaFalse.readUInt32LE(21) & ~0x10000000;
  alphaFalse.writeUInt32LE(alphaHeader, 21);
  assert.equal(parseWebp(alphaFalse, "mutated-compact.webp").hasAlpha, false, "alpha bit mutation must be observable");
  assert.throws(
    () => validate(ROOT, { "public/xot-logo-compact.webp": alphaFalse }),
    /reviewed SHA-256/,
    "alpha mutation must fail the exact derivative hash",
  );

  assert.throws(
    () => validate(ROOT, { "public/xot-logo-full.webp": Buffer.from([...fullWebp, 0]) }),
    /reviewed byte size/,
    "full derivative SHA/size mutation must fail the characterization contract",
  );
  assert.throws(
    () => validate(ROOT, { "public/xot-logo-compact.webp": Buffer.from([...compactWebp, 0]) }),
    /reviewed byte size/,
    "compact derivative SHA/size mutation must fail the characterization contract",
  );
  assert.throws(
    () => validate(ROOT, { "public/xot-logo.png": Buffer.alloc(0) }),
    /reviewed byte size/,
    "empty original mutation must fail the characterization contract",
  );
  assert.throws(
    () => validate(ROOT, { "public/xot-logo-full.webp": Buffer.concat([fullWebp, Buffer.alloc(89_572)]) }),
    /reviewed byte size/,
    "heavy derivative mutation must fail the weight contract",
  );
  assert.throws(
    () => validate(ROOT, {
      "src/components/layout/BrandLogo.tsx": readFileSync(join(ROOT, "src/components/layout/BrandLogo.tsx"), "utf8").replace("/xot-logo-full.webp", "/missing-logo.webp"),
    }),
    /must retain the \/xot-logo-full\.webp asset reference/,
    "missing derivative source reference mutation must fail the characterization contract",
  );
  assert.throws(
    () => validate(ROOT, {
      "index.html": readFileSync(join(ROOT, "index.html"), "utf8").replace("/apple-touch-icon.png", "/missing-icon.png"),
    }),
    /must retain the \/apple-touch-icon\.png asset reference/,
    "missing metadata fallback mutation must fail the characterization contract",
  );
  const changedSource = readFileSync(join(ROOT, "public/xot-logo.png"));
  changedSource[changedSource.length - 1] ^= 0xff;
  assert.throws(
    () => validate(ROOT, { "public/xot-logo.png": changedSource }),
    /reviewed SHA-256/,
    "deterministic source-content mismatch must fail source linkage",
  );

  const malformedRiff = Buffer.from(fullWebp);
  malformedRiff.writeUInt32LE(malformedRiff.length, 4);
  assert.throws(() => parseWebp(malformedRiff, "malformed-riff.webp"), /RIFF length/);
  const malformedChunk = Buffer.from(fullWebp);
  malformedChunk.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => parseWebp(malformedChunk, "malformed-chunk.webp"), /beyond the RIFF boundary/);
  const malformedType = Buffer.from(fullWebp);
  malformedType.write("BAD!", 12, "ascii");
  assert.throws(() => parseWebp(malformedType, "malformed-type.webp"), /unsupported WebP chunk type/);
  runContainerMutationTests();
}

function runContract() {
  assertInventoryManifests();
  const result = validate();
  const reviewSignals = result.assets.filter((asset) => asset.reviewSignal).map((asset) => asset.path);

  if (process.env.MUTATION_TEST === "1") runMutationTests();

  const sizes = Object.fromEntries(result.assets.map((asset) => [asset.label, asset.bytes]));
  const reductionPercent = ((1 - result.deliveredBytes / result.baselineBytes) * 100).toFixed(2);
  console.log(`ASSET_WEIGHT_CHARACTERIZATION_SOURCE_CONTRACT_PASS assets=${result.assets.length} sourceFiles=${SOURCE_FILES.length} reviewSignals=${reviewSignals.length} sizes=${JSON.stringify(sizes)} baselineBytes=${result.baselineBytes} deliveredBytes=${result.deliveredBytes} reductionPercent=${reductionPercent} mutation=${process.env.MUTATION_TEST === "1" ? "pass" : "skipped"}`);
  for (const path of reviewSignals) console.log(`ASSET_WEIGHT_REVIEW_SIGNAL ${path}`);
}

const isMain = process.argv[1] && new URL(`file://${process.argv[1]}`).pathname === new URL(import.meta.url).pathname;
if (isMain) runContract();

export {
  ASSET_FILES,
  DERIVATIVE_ASSETS,
  ORIGINAL_ASSETS,
  REQUIRED_REFERENCES,
  SOURCE_FILES,
  createVp8Payload,
  createVp8xPayload,
  createWebpChunk,
  createWebpFixture,
  parsePng,
  parseWebp,
  runContainerMutationTests,
  runMutationTests,
  validate,
};
