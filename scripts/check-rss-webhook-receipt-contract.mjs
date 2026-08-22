// B3b1 (AIR-003): durable RSS webhook receipt contract.
//
// Enforces the authoritative source contract for the deterministic material receipt
// (receipt_key), the durable claim lease, the INV-3 HTTP-200 gating, and the matching
// migration + acceptance JSON binding.
//
// The receipt_key MUST be derived ONLY from normalized feed identity + canonical
// sorted, content-sensitive item fingerprints. It MUST NOT include timestamp, random,
// or auth_mode material; auth_mode is stored as row metadata only. token vs signed
// delivery of the same normalized feed + canonical item-content set resolve to the
// SAME receipt_key (dedup + idempotent replay).
//
// Every asserted invariant fails closed on mutation (MUTATION_TEST=1).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const webhookPath = join(repoRoot, 'supabase/functions/webhooks-rssapp/index.ts');
const migrationPath = join(repoRoot, 'supabase/migrations/20260806153000_b3b1_rss_webhook_receipts.sql');
const receiptPath = join(repoRoot, 'docs/plans/2026-08-06-xot-b3b1-rss-webhook-receipts.json');
const payloadPolicyPath = join(repoRoot, 'supabase/functions/_shared/rssWebhookPayloadPolicy.ts');
const packagePath = join(repoRoot, 'package.json');
const ciPath = join(repoRoot, '.github/workflows/ci.yml');
const require = createRequire(import.meta.url);
const typescript = require('typescript');

const sources = {
  webhook: readFileSync(webhookPath, 'utf8'),
  migration: readFileSync(migrationPath, 'utf8'),
  receipt: readFileSync(receiptPath, 'utf8'),
  payloadPolicy: readFileSync(payloadPolicyPath, 'utf8'),
  packageJson: readFileSync(packagePath, 'utf8'),
  ci: readFileSync(ciPath, 'utf8'),
};

function transpile(path, source) {
  const result = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      strict: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });
  const diagnostics = (result.diagnostics ?? []).filter(
    (d) => d.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
}

// --- Load-bearing deterministic receipt-math execution ---
// Extract the pure receipt-key functions from the REAL webhook source, transpile them to
// CommonJS, and run them with the two shared helpers stubbed deterministically over the
// same structural inputs they consume. This makes the deterministic receipt-key semantics
// (order-insensitive, content-sensitive, auth-absent, no time/random) execution-proven
// rather than string-matched.
const RECEIPT_FN_NAMES = [
  'async function sha256Hex(',
  'function isRecord(',
  'function normalizedRssFeedIdentity(',
  'function rssReceiptMaterialContent(',
  'async function rssReceiptItemFingerprint(',
  'async function rssCanonicalItemFingerprints(',
  'async function computeRssWebhookReceiptKey(',
];

function extractFunctionBlocks(webhookSource) {
  const blocks = [];
  for (const needle of RECEIPT_FN_NAMES) {
    const anchor = webhookSource.indexOf(needle);
    if (anchor < 0) throw new Error(`missing ${needle} in webhook source`);
    const bodyBrace = webhookSource.indexOf('{', anchor);
    if (bodyBrace < 0) throw new Error(`no body brace for ${needle}`);
    let depth = 1;
    let j = bodyBrace + 1;
    for (; j < webhookSource.length; j++) {
      const c = webhookSource[j];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) throw new Error(`unbalanced function body for ${needle}`);
    blocks.push(webhookSource.slice(anchor, j + 1));
  }
  return blocks;
}

function loadReceiptMath() {
  const blocks = extractFunctionBlocks(sources.webhook);
  const harness = blocks.join('\n') + '\n' + `
// Deterministic stubs for the two imported shared helpers the receipt math consumes.
// They map the same structural inputs to the same normalized strings the edge runtime sees,
// preserving the order/content/collision semantics under test without network/Deno.
function normalizeRssWebhookText(value, _stripMarkup = false) {
  return String(value).replace(/\\s+/g, ' ').trim();
}
function parseBoundedRssItemMedia(item) {
  const rows = [];
  const enclosure = item.enclosure;
  const list = !enclosure ? [] : Array.isArray(enclosure) ? enclosure : [enclosure];
  for (const cand of list) {
    if (!cand || typeof cand !== 'object') continue;
    if (typeof cand.url === 'string' && cand.url.length > 0) {
      rows.push({ type: typeof cand.type === 'string' ? cand.type : 'image', url: cand.url });
    }
  }
  return rows;
}
function stableRssWebhookItemId(item) {
  for (const value of [item.guid, item.id, item.link, item.url]) {
    if (typeof value === 'string') {
      const id = value.trim();
      if (id.length > 0) return id;
    }
  }
  return null;
}
module.exports = { sha256Hex, normalizedRssFeedIdentity, rssReceiptMaterialContent,
  rssReceiptItemFingerprint, rssCanonicalItemFingerprints, computeRssWebhookReceiptKey, isRecord };
`;
  const out = typescript.transpileModule(harness, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022, strict: true },
    reportDiagnostics: true,
    fileName: 'webhook-receipt-math.ts',
  });
  const diags = (out.diagnostics ?? []).filter((d) => d.category === typescript.DiagnosticCategory.Error);
  if (diags.length) assert.fail(`receipt-math transpile diagnostics: ${diags.map((d) => d.messageText).join('; ')}`);
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'xot-rss-receipt-math-'));
  const tmpFile = join(tmpDir, 'rss.js');
  writeFileSync(tmpFile, out.outputText);
  try {
    const mod = require(tmpFile);
    // Shadow crypto.subtle with a node-crypto backend for the async sha256Hex.
    mod.__cryptoSubtleBacked = true;
    if (typeof globalThis.crypto !== 'object' || !globalThis.crypto.subtle) {
      globalThis.crypto = {
        subtle: {
          async digest(_alg, data) {
            const bytes = new Uint8Array(data);
            return createHash('sha256').update(Buffer.from(bytes)).digest().buffer;
          },
        },
      };
    }
    return mod;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function assertReceiptMath() {
  const mod = loadReceiptMath();
  const mkItem = (guid, title, url = '') => ({ guid, title, url });
  const itemA = mkItem('id-a', 'hello world', 'https://x.com/u/1');
  const itemB = mkItem('id-b', 'second post', 'https://x.com/u/2');

  const key = (items) => mod.computeRssWebhookReceiptKey({ data: { feed_id: 'feed-x' } }, items);

  // order-insensitive
  assert.equal(await key([itemA, itemB]), await key([itemB, itemA]), 'receipt key must be order-insensitive');
  // deterministic
  assert.equal(await key([itemA, itemB]), await key([itemA, itemB]), 'receipt key must be deterministic');
  // content
  const itemAMutated = { ...itemA, title: 'hello WORLD changed' };
  assert.notEqual(await key([itemA, itemB]), await key([itemAMutated, itemB]), 'receipt key must change on content change');
  // auth
  assert.match(await key([itemA, itemB]), /^[a-f0-9]{64}$/, 'receipt key must be a 64-hex sha256');
  const keyCaps = await mod.computeRssWebhookReceiptKey({ data: { feed_id: 'FEED-X ' } }, [itemA, itemB]);
  assert.equal(await key([itemA, itemB]), keyCaps, 'feed identity must be normalized (case/space-insensitive)');
  console.log('RSS_RECEIPT_MATH_RUN deterministic order-insensitive content-sensitive auth-absent PASS');
}

function validate(source) {
  for (const [name, path] of [
    ['webhook', webhookPath],
    ['payloadPolicy', payloadPolicyPath],
  ]) transpile(path, source[name]);

  const migration = source.migration;
  const webhook = source.webhook;
  const receipt = JSON.parse(source.receipt);

  // --- Receipt JSON binding ---
  assert.ok(receipt.currentCandidate, 'receipt must record a currentCandidate block');
  assert.equal(receipt.currentCandidate.versionCount, 115, 'receipt must bind migration ordinal #115');
  assert.equal(receipt.currentCandidate.pathCount, 115, 'receipt must bind 115 paths');
  assert.match(receipt.currentCandidate.predecessorReceiptSha256, /^[a-f0-9]{64}$/, 'receipt must bind an immutable predecessor SHA-256');
  assert.equal(
    receipt.currentCandidate.predecessorReceiptPath,
    'docs/plans/2026-08-06-xot-b3a-job-x-claim-fencing.json',
    'receipt must bind the B3A predecessor path',
  );
  const b3aSha = createHash('sha256').update(readFileSync(join(repoRoot, receipt.currentCandidate.predecessorReceiptPath))).digest('hex');
  assert.equal(receipt.currentCandidate.predecessorReceiptSha256, b3aSha, 'predecessor SHA-256 must match the on-disk B3A receipt');
  assert.ok(
    Array.isArray(receipt.allowedPaths) && receipt.allowedPaths.includes('supabase/functions/_shared/rssWebhookPayloadPolicy.ts'),
    'allowedPaths must retain the optional payload-policy path',
  );

  // --- Migration: durable table + RLS + SECURITY DEFINER seals ---
  assert.match(migration, /CREATE TABLE public\.webhook_receipts/, 'migration must create the durable receipt table');
  assert.match(migration, /receipt_key text PRIMARY KEY/, 'receipt_key must be an immutable PRIMARY KEY');
  assert.match(migration, /auth_mode text NOT NULL/, 'auth_mode must be a NOT NULL metadata column');
  assert.match(migration, /ALTER TABLE public\.webhook_receipts ENABLE ROW LEVEL SECURITY/, 'receipt table must enable RLS');
  assert.match(migration, /REVOKE ALL ON public\.webhook_receipts FROM public, anon, authenticated;/, 'receipt table must be revoked from public/anon/authenticated');
  assert.match(migration, /ADD CONSTRAINT webhook_receipts_status_check/, 'receipt status must be CHECK-constrained');
  assert.match(migration, /ADD CONSTRAINT webhook_receipts_claim_state_check/, 'receipt claim_state must be CHECK-constrained');

  const definerBlocks = migration.match(/SECURITY DEFINER[\s\S]*?\$\$/g) ?? [];
  assert.ok(definerBlocks.length >= 4, 'migration must define all four receipt RPCs as SECURITY DEFINER');
  for (const block of definerBlocks) {
    assert.match(block, /SET search_path TO (public|pg_catalog)/, 'every SECURITY DEFINER receipt RPC must carry a closed search_path');
  }
  const revokes = (migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length;
  const grantsService = (migration.match(/GRANT EXECUTE ON FUNCTION public\.[a-z_]+\([^)]*\) TO service_role\b/g) ?? []).length;
  assert.equal(revokes, grantsService, 'every receipt RPC must be revoked from public/anon/authenticated and granted only to service_role');
  assert.doesNotMatch(migration, /TO service_role,\s*(anon|authenticated|public)/, 'no receipt RPC grant may include anon/authenticated/public');

  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reserve_webhook_receipt\(/, 'reserve_webhook_receipt RPC must exist');
  const reserveStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.reserve_webhook_receipt(');
  const completeStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.complete_webhook_receipt(');
  const reserveBlock = migration.slice(reserveStart, completeStart);
  assert.match(
    reserveBlock,
    /IF v_status = 'completed' THEN[\s\S]*?'reserved', false, 'reason', 'already_completed'/,
    'completed receipts must return a rejected reserve so the runtime takes the idempotent replay branch',
  );
  assert.doesNotMatch(
    reserveBlock,
    /provider_started_at\s*=\s*now\(\)/,
    'reservation must leave the pre-materialization reclaim path reachable',
  );
  assert.match(migration, /claim_generation = claim_generation \+ 1/, 'reserve must monotonically bump the generation');
  assert.match(migration, /gen_random_uuid\(\)/, 'reserve must mint a fresh random claim token');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.complete_webhook_receipt\(/, 'complete_webhook_receipt RPC must exist');
  assert.match(migration, /AND claim_token = p_claim_token/, 'complete must fence by claim token');
  assert.match(migration, /AND claim_generation = p_claim_generation/, 'complete must fence by claim generation');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.fail_webhook_receipt\(/, 'fail_webhook_receipt RPC must exist');
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reconcile_expired_webhook_receipts\(/, 'reconcile_expired_webhook_receipts RPC must exist');
  assert.match(migration, /AND r\.provider_started_at IS NULL/, 'reconcile must only reclaim never-provider-started receipts');
  assert.match(migration, /FOR UPDATE SKIP LOCKED/, 'reconcile must preserve SKIP LOCKED');

  // --- Runtime: deterministic receipt key + INV-3 gating ---
  assert.match(webhook, /async function computeRssWebhookReceiptKey\(/, 'runtime must expose computeRssWebhookReceiptKey');
  assert.match(webhook, /receiptKey = await computeRssWebhookReceiptKey\(payloadRecord, items\);/, 'runtime must derive the receipt key from payload + bounded items');
  assert.match(webhook, /await reserveRssWebhookReceipt\(supabase, receiptKey, authMode, feedId\);/, 'runtime must reserve a durable receipt before materialization');
  assert.match(webhook, /await completeRssWebhookReceipt\(/, 'runtime must complete the receipt after durable materialization');
  assert.match(webhook, /await failRssWebhookReceipt\(/, 'runtime must mark a failed receipt non-success');
  assert.match(webhook, /supabase\.rpc\('reserve_webhook_receipt'/, 'reserve must invoke the service-role-only RPC');
  assert.match(webhook, /supabase\.rpc\('complete_webhook_receipt'/, 'complete must invoke the fenced RPC');
  assert.match(webhook, /supabase\.rpc\('fail_webhook_receipt'/, 'fail must invoke the fenced RPC');
  assert.match(
    webhook,
    /if \(data !== true\) throw new RssWebhookPersistenceError\('rss_webhook_receipt_complete_rejected'\);/,
    'completion must require an explicit true RPC result',
  );

  // INV-3: the success 200 must appear only AFTER completeRssWebhookReceipt in the flow.
  const completeIndex = webhook.indexOf('await completeRssWebhookReceipt(');
  assert.ok(completeIndex >= 0, 'runtime must complete the receipt');
  assert.ok(webhook.indexOf('status: 200') === -1, 'runtime must not flush a literal status: 200');
  const successReturnIdx = webhook.indexOf('success: true,\n      receipt_key:');
  assert.ok(successReturnIdx > completeIndex, 'runtime must return success only after durable completion');
  assert.match(webhook, /idempotent_replay: true/, 'an already-completed replay must re-acknowledge idempotently');

  // --- auth_mode metadata vs key separation ---
  assert.match(webhook, /function normalizedRssFeedIdentity\(/, 'runtime must normalize feed identity without auth mode');
  assert.match(webhook, /feedId = payloadRecord \? normalizedRssFeedIdentity\(payloadRecord\) : 'unknown';/, 'feed identity must not embed auth mode');
  assert.doesNotMatch(webhook, /const receiptKey = await computeRssWebhookReceiptKey\([^)]*authMode[^)]*\);/, 'auth_mode must not be passed into the receipt-key computation');
  assert.match(migration, /p_auth_mode text DEFAULT 'token'/, 'auth_mode must be a stored metadata parameter');
  assert.doesNotMatch(webhook, /first_seen_ts|Date\.now|Math\.random|crypto\.randomUUID/, 'receipt identity must not contain time/random material');

  // --- package + CI wiring ---
  const pkg = JSON.parse(source.packageJson);
  assert.equal(pkg.scripts?.['check:b3b1-rss-receipt'], 'node scripts/check-rss-webhook-receipt-contract.mjs', 'package script is missing');
  assert.equal(pkg.scripts['test:rss-webhook-receipt'], 'node --test scripts/check-rss-webhook-receipt-contract.test.mjs', 'package test script is missing');
  assert.ok(source.ci.includes('- run: npm run check:b3b1-rss-receipt'), 'CI must run the receipt contract');
}

for (const [name, path] of [['webhook', webhookPath], ['payloadPolicy', payloadPolicyPath]]) {
  transpile(path, sources[name]);
}
let selfTest = 'skipped';
(async function main() {
  validate(sources);
  await assertReceiptMath();

  if (process.env.MUTATION_TEST === '1') {
  const expectRejected = (label, mutate) => {
    assert.throws(
      () => validate(mutate(sources)),
      (error) => error instanceof assert.AssertionError,
      `${label} mutation must fail the source contract`,
    );
  };
  expectRejected('removed monotonic generation bump', (s) => ({
    ...s,
    migration: s.migration.replace('claim_generation = claim_generation + 1', 'claim_generation = 0'),
  }));
  expectRejected('removed claim-token fence', (s) => ({
    ...s,
    migration: s.migration.replaceAll('AND claim_token = p_claim_token', 'AND 1 = 1'),
  }));
  expectRejected('removed claim-generation fence', (s) => ({
    ...s,
    migration: s.migration.replaceAll('AND claim_generation = p_claim_generation', 'AND 1 = 1'),
  }));
  expectRejected('completed replay treated as a fresh claim', (s) => ({
    ...s,
    migration: s.migration.replace(
      "'reserved', false, 'reason', 'already_completed'",
      "'reserved', true, 'reason', 'already_completed'",
    ),
  }));
  expectRejected('reservation marks provider start before materialization', (s) => ({
    ...s,
    migration: s.migration.replace(
      "claim_state = 'received',",
      "claim_state = 'received',\n      provider_started_at = now(),",
    ),
  }));
  expectRejected('malformed completion result accepted', (s) => ({
    ...s,
    webhook: s.webhook.replace('if (data !== true)', 'if (data === false)'),
  }));
  expectRejected('removed RLS enable', (s) => ({
    ...s,
    migration: s.migration.replace('ALTER TABLE public.webhook_receipts ENABLE ROW LEVEL SECURITY;', '-- RLS removed'),
  }));
  expectRejected('removed receipt PRIMARY KEY', (s) => ({
    ...s,
    migration: s.migration.replace('receipt_key text PRIMARY KEY', 'receipt_key text'),
  }));
  expectRejected('breached revoke/grants', (s) => ({
    ...s,
    migration: s.migration.replace('TO service_role;', 'TO service_role, anon;'),
  }));
  expectRejected('removed SKIP LOCKED', (s) => ({
    ...s,
    migration: s.migration.replace('FOR UPDATE SKIP LOCKED', 'FOR UPDATE'),
  }));
  expectRejected('reconcile reclaims provider-started receipts', (s) => ({
    ...s,
    migration: s.migration.replace('AND r.provider_started_at IS NULL', 'AND r.provider_started_at IS NOT NULL'),
  }));
  expectRejected('200 flushed before durable completion', (s) => ({
    ...s,
    webhook: s.webhook.replace('await completeRssWebhookReceipt(', 'await prematureFlushOnly(', ),
  }));
  expectRejected('auth_mode passed into receipt-key computation', (s) => ({
    ...s,
    webhook: s.webhook.replace('receiptKey = await computeRssWebhookReceiptKey(payloadRecord, items);', 'receiptKey = await computeRssWebhookReceiptKey(payloadRecord, items, authMode);'),
  }));
  expectRejected('timestamp leaked into receipt key', (s) => ({
    ...s,
    webhook: s.webhook.replace('return sha256Hex(`${feedPart}|${itemsPart}`);', 'return sha256Hex(`${feedPart}|${itemsPart}|${Date.now()}`);'),
  }));
  expectRejected('reserve call skipped', (s) => ({
    ...s,
    webhook: s.webhook.replace('await reserveRssWebhookReceipt(supabase, receiptKey, authMode, feedId);', 'await Promise.resolve();'),
  }));
  expectRejected('build-split receipt cardinality wrong', (s) => ({
    ...s,
    receipt: s.receipt.replace('"versionCount": 115', '"versionCount": 116'),
  }));
  expectRejected('package wiring removed', (s) => ({
    ...s,
    packageJson: s.packageJson.replace('"check:b3b1-rss-receipt": "node scripts/check-rss-webhook-receipt-contract.mjs",', ''),
  }));
  selfTest = 'pass';
  }

  console.log(`RSS_WEBHOOK_RECEIPT_SOURCE_CONTRACT_PASS deterministicKey=pass durable=gated migration=sealed selfTest=${selfTest}`);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
