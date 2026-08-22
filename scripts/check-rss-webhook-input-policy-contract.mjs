import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  policy: join(repoRoot, "supabase/functions/_shared/rssWebhookPayloadPolicy.ts"),
  itemParser: join(repoRoot, "supabase/functions/_shared/rssWebhookItemParser.ts"),
  auth: join(repoRoot, "supabase/functions/_shared/internalAuth.ts"),
  webhook: join(repoRoot, "supabase/functions/webhooks-rssapp/index.ts"),
  mediaPolicy: join(repoRoot, "supabase/functions/_shared/remoteMediaPolicy.ts"),
};
const require = createRequire(import.meta.url);
const typescript = require("typescript");
const sources = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [name, readFileSync(path, "utf8")]),
);

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
    (diagnostic) => diagnostic.category === typescript.DiagnosticCategory.Error,
  );
  assert.equal(diagnostics.length, 0, `${path} must transpile without TypeScript diagnostics`);
  return result.outputText;
}

function indexOfOrFail(source, needle, message) {
  const index = source.indexOf(needle);
  assert.ok(index >= 0, message);
  return index;
}

function functionSlice(source, startNeedle, endNeedle) {
  const start = indexOfOrFail(source, startNeedle, `missing ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end >= 0 ? end : source.length);
}

function validateStructural(source) {
  for (const [name, expected] of [
    ["MAX_RSS_WEBHOOK_BODY_BYTES", "1 * 1024 * 1024"],
    ["MAX_RSS_WEBHOOK_BODY_CHUNKS", "4_096"],
    ["MAX_RSS_WEBHOOK_JSON_DEPTH", "32"],
    ["MAX_RSS_WEBHOOK_JSON_NODES", "4_096"],
    ["MAX_RSS_WEBHOOK_ITEMS", "25"],
    ["MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM", "16"],
  ]) {
    assert.match(source.policy, new RegExp(`${name} = ${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `${name} must remain bounded`);
  }
  assert.match(source.policy, /request\.body\.getReader\(\)/, "RSS body must use a bounded stream reader");
  assert.match(source.policy, /value\.byteLength > MAX_RSS_WEBHOOK_BODY_BYTES - bytesRead/, "chunked RSS bodies must enforce byte limits");
  assert.match(source.policy, /if \(chunksRead > MAX_RSS_WEBHOOK_BODY_CHUNKS\)/, "RSS bodies must limit fragmented stream work");
  assert.doesNotMatch(source.policy, /const chunks: Uint8Array\[\] = \[\];/, "RSS bodies must not retain attacker-controlled chunk arrays");
  assert.match(source.policy, /assertContentLength\(request\)/, "RSS Content-Length must be checked before reading");
  assert.match(source.policy, /assertContentEncoding\(request\)/, "compressed RSS input must be rejected");
  assert.match(source.policy, /new TextDecoder\("utf-8", \{ fatal: true \}\)/, "RSS body text must reject invalid UTF-8");
  assert.match(source.policy, /assertBoundedJsonSyntax\(rawBody, limits\)/, "JSON depth/node scan must precede JSON.parse");
  assert.match(source.policy, /parsed = JSON\.parse\(rawBody\)/, "bounded RSS body must still be parsed as JSON");
  assert.match(source.policy, /assertBoundedJsonShape\(parsed, limits\)/, "parsed RSS JSON must retain a shape check");
  assert.match(source.policy, /return parseBoundedJson\(rawBody, RSS_WEBHOOK_JSON_LIMITS\);/, "RSS parsing must retain its tighter RSS limits");
  assert.match(source.policy, /extractBoundedRssWebhookItems/, "RSS item extraction must have a shared bounded boundary");
  assert.match(source.policy, /candidates\.length > MAX_RSS_WEBHOOK_ITEMS/, "RSS item count must be capped");
  assert.match(source.policy, /ITEM_MEDIA_ARRAY_FIELDS/, "nested RSS media arrays must be checked");
  assert.match(source.policy, /value\.length > MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM/, "nested RSS media arrays must have a cap");

  assert.match(source.policy, /export async function readBoundedRssWebhookBody/, "RSS body reader must retain exact bytes alongside decoded text");
  assert.match(source.policy, /buildRssWebhookSignatureInput/, "RSS signatures must be built from original bytes");
  assert.match(source.auth, /readBoundedRssWebhookBody\(req\.clone\(\)\)/, "direct signed-auth callers must retain a bounded byte-preserving body fallback");
  assert.doesNotMatch(source.auth, /\.clone\(\)\.text\(/, "signed RSS auth must not restore an unbounded clone.text read");
  assert.match(source.auth, /rawBodyBytes\?: Uint8Array/, "signed auth must carry exact body bytes");
  assert.match(source.auth, /buildRssWebhookSignatureInput\(parsed\.timestamp, rawBodyBytes\)/, "HMAC must prefer original body bytes");
  assert.match(source.auth, /export function readRssWebhookAuthMode/, "webhook must classify credentials before body buffering");
  const rssTokenReader = functionSlice(source.auth, "function readRssWebhookExpectedToken", "\n}\n\nfunction readRssAppSigningSecret");
  const rssAuth = source.auth.slice(indexOfOrFail(source.auth, "export async function requireRssWebhookAuth", "RSS auth helper must remain present"));
  assert.doesNotMatch(rssTokenReader, /WEBHOOK_SHARED_SECRET/, "RSS auth must not reuse the shared internal secret");
  assert.doesNotMatch(rssAuth, /verify_webhook_internal_token/, "RSS auth must not fall back to the internal Vault verifier");
  assert.match(source.auth, /export async function rssWebhookInternalAuthHeaders/, "admin validation must support a dedicated token or signed header");

  const authModeIndex = indexOfOrFail(source.webhook, "const authMode = readRssWebhookAuthMode(req);", "webhook must classify credentials before body buffering");
  const tokenAuthIndex = indexOfOrFail(source.webhook, "if (authMode === 'token')", "token requests must authenticate before body buffering");
  const rawReadIndex = indexOfOrFail(source.webhook, "const boundedBody = await readBoundedRssWebhookBody(req);", "webhook must perform one bounded raw-body read");
  const signedAuthIndex = indexOfOrFail(source.webhook, "if (authMode === 'signed')", "signed requests must verify after the exact body read");
  const parseIndex = indexOfOrFail(source.webhook, "payload = parseBoundedRssWebhookJson(rawBody);", "webhook must parse bounded raw bytes");
  const itemsIndex = indexOfOrFail(source.webhook, "items = extractBoundedRssWebhookItems(payload);", "webhook must extract bounded items");
  const persistenceIndex = indexOfOrFail(source.webhook, "const duplicateGateEnabled = await isDuplicateGateEnabled(supabase);", "webhook persistence path must remain present");
  assert.ok(authModeIndex < tokenAuthIndex && tokenAuthIndex < rawReadIndex, "token auth must reject before body allocation");
  assert.ok(rawReadIndex < signedAuthIndex && signedAuthIndex < parseIndex, "raw bytes must be available before signed HMAC verification and JSON parsing");
  assert.ok(parseIndex < itemsIndex && itemsIndex < persistenceIndex, "shape/item limits must run before database work");
  const signedAuthCall = source.webhook.slice(signedAuthIndex, parseIndex);
  assert.match(
    signedAuthCall,
    /requireRssWebhookAuth\(req, null, corsHeaders, \{\s*rawBody,\s*rawBodyBytes,\s*\}\)/s,
    "the production signed-auth call must pass exact bounded body bytes to HMAC verification",
  );
  assert.doesNotMatch(source.webhook, /req\.json\(\)/, "webhook must not restore unbounded req.json");
  assert.match(source.webhook, /status: rssWebhookPayloadErrorStatus\(error\)/, "webhook limit errors must expose stable HTTP statuses");
  assert.match(source.webhook, /code: error\.code/, "webhook input errors must use stable codes without raw payload text");
  assert.match(source.webhook, /shape: payloadIsRecord \? 'object' : payload === null \? 'null'/, "payload telemetry must use a structural shape label");
  assert.match(source.webhook, /key_count: payloadIsRecord \? Object\.keys\(payload as Record<string, unknown>\)\.length : 0/, "payload telemetry may count keys but must not emit their values");
  assert.doesNotMatch(source.webhook, /shape:\s*typeof payload === 'object' && !Array\.isArray\(payload\) \? Object\.keys\(/, "payload telemetry must not emit attacker-controlled key names");

  assert.match(source.webhook, /parseBoundedRssItemMedia\(item, text\)/, "webhook must use the bounded item media parser");
  assert.match(source.webhook, /normalizeRssWebhookText\(item\.description, true\)/, "webhook HTML cleanup must use the linear normaliser");
  assert.doesNotMatch(source.webhook, /replace\(\/<\[\^>\]\*>,/, "webhook must not restore greedy HTML cleanup regexes");
  const textNormaliser = functionSlice(source.itemParser, "export function normalizeRssWebhookText", "\nfunction parseBoundedHtmlTag");
  assert.match(textNormaliser, /const output: string\[\] = \[\];/, "RSS text cleanup must use an append-only buffer");
  assert.doesNotMatch(textNormaliser, /output \+=/, "RSS text cleanup must not repeatedly concatenate untrusted text");
  assert.match(textNormaliser, /tagCandidate\.length === 1 && !isRssTagOpeningCharacter\(char\)/, "RSS text cleanup must preserve literal less-than characters");
  assert.match(textNormaliser, /entityCandidate\.length === 1 && !isRssEntityCharacter\(char\)/, "RSS text cleanup must preserve non-entity ampersands");
  assert.match(source.itemParser, /MAX_RSS_WEBHOOK_HTML_TAG_ATTEMPTS_PER_ITEM = 128/, "RSS HTML tag scan attempts must be bounded");
  assert.match(source.itemParser, /MAX_RSS_WEBHOOK_HTML_TAG_CHARACTERS = 4_096/, "RSS HTML tag length must be bounded");
  assert.match(source.itemParser, /if \(tagAttempts >= MAX_RSS_WEBHOOK_HTML_TAG_ATTEMPTS_PER_ITEM\) return;/, "RSS HTML parser must stop before unbounded tag scans");
  const mediaAppender = functionSlice(source.itemParser, "function inspectRssMediaCandidate", "\nfunction mediaFromUrl");
  assert.match(mediaAppender, /if \(inspected\.count >= MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM\) return false;/, "RSS media parser must retain an inspected-input cap");
  const candidateIncrement = indexOfOrFail(mediaAppender, "inspected.count += 1;", "RSS candidate inspection must consume budget");
  const candidateValidation = indexOfOrFail(mediaAppender, "if (!candidate) return true;", "RSS candidate validation must remain after inspection");
  assert.ok(candidateIncrement < candidateValidation, "invalid candidates must consume parser budget before validation");
  assert.doesNotMatch(source.itemParser, /<img\[\^>\]\+src/, "RSS parser must not restore greedy HTML tag regexes");
  assert.doesNotMatch(source.itemParser, /\.match\(/, "RSS parser must not allocate unbounded regex match arrays");
  assert.match(source.webhook, /filterReviewedRemoteMediaItems\(prefilteredMediaItems\)/, "reviewed-host media policy remains the downstream ingress gate");
  assert.match(source.mediaPolicy, /MAX_REMOTE_MEDIA_CANDIDATES_PER_POST = 8/, "media egress candidate cap remains present");
}

for (const [name, path] of Object.entries(paths)) transpile(path, sources[name]);
validateStructural(sources);

const policyModuleUrl = `data:text/javascript;base64,${Buffer.from(transpile(paths.policy, sources.policy)).toString("base64")}`;
const policy = await import(policyModuleUrl);
const itemParserSource = transpile(paths.itemParser, sources.itemParser)
  .replace("./rssWebhookPayloadPolicy.ts", policyModuleUrl);
const itemParser = await import(
  `data:text/javascript;base64,${Buffer.from(itemParserSource).toString("base64")}`,
);

function expectCode(fn, code, message = `expected ${code}`) {
  return assert.rejects(fn, (error) => error?.code === code, message);
}

const validPayload = JSON.stringify({
  data: {
    items_new: [{
      guid: "rss-item-1",
      title: "A bounded RSS item",
      enclosure: [{ url: "https://pbs.twimg.com/media/a.jpg", type: "image/jpeg" }],
    }],
  },
});
const validBody = await policy.readBoundedRssWebhookBody(
  new Request("https://example.test/webhook", { method: "POST", body: validPayload }),
);
const validRaw = validBody.text;
assert.equal(validRaw, validPayload, "bounded reader must preserve JSON text");
assert.deepEqual(
  [...validBody.bytes],
  [...new TextEncoder().encode(validPayload)],
  "bounded reader must preserve exact signed bytes",
);
const validParsed = policy.parseBoundedRssWebhookJson(validRaw);
assert.equal(policy.extractBoundedRssWebhookItems(validParsed).length, 1, "valid RSS.app payload must remain accepted");

const bomBytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(validPayload)]);
const bomBody = await policy.readBoundedRssWebhookBody(
  new Request("https://example.test/webhook", { method: "POST", body: bomBytes }),
);
assert.equal(bomBody.text, validPayload, "JSON text may decode a BOM without changing signature bytes");
assert.deepEqual([...bomBody.bytes], [...bomBytes], "BOM bytes must remain available for HMAC");
assert.deepEqual(
  [...policy.buildRssWebhookSignatureInput(123, bomBody.bytes)],
  [...new TextEncoder().encode("123."), ...bomBytes],
  "HMAC input must concatenate the timestamp prefix and exact original bytes",
);

const validMedia = itemParser.parseBoundedRssItemMedia({
  description_html: '<img src="https://pbs.twimg.com/media/valid.jpg">',
}, "");
assert.equal(validMedia.length, 1, "valid bounded RSS HTML media must remain accepted");
const malformedHtml = "<img src=\"not-media".repeat(itemParser.MAX_RSS_WEBHOOK_HTML_TAG_ATTEMPTS_PER_ITEM * 4);
const malformedMedia = itemParser.parseBoundedRssItemMedia({ description_html: malformedHtml }, "");
assert.equal(malformedMedia.length, 0, "malformed RSS HTML must stop without producing media");
const invalidCandidatesBeforeValid = itemParser.parseBoundedRssItemMedia({
  thumbnail: 0,
  enclosure: Array.from(
    { length: policy.MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM - 1 },
    () => ({ url: "https://example.test/not-media" }),
  ),
  "media:content": { url: "https://pbs.twimg.com/media/should-not-be-inspected.jpg", type: "image/jpeg" },
}, "");
assert.equal(
  invalidCandidatesBeforeValid.length,
  0,
  "invalid candidates must consume all parser budget before a later valid media URL",
);
assert.equal(
  itemParser.normalizeRssWebhookText("visible <img", true),
  "visible <img",
  "unterminated literal markup must remain visible rather than truncating RSS text",
);
assert.equal(
  itemParser.normalizeRssWebhookText("one&amp;two", true),
  "one two",
  "bounded entity cleanup must preserve a content separator",
);
assert.equal(
  itemParser.normalizeRssWebhookText("AT&T earnings?x=1&y=2", true),
  "AT&T earnings?x=1&y=2",
  "literal ampersands without semicolon-terminated entities must remain intact",
);
assert.equal(
  itemParser.normalizeRssWebhookText("AT&T earnings &amp; reports <3", true),
  "AT&T earnings reports <3",
  "literal ampersands and less-than text must survive beside valid entities",
);

await expectCode(
  () => policy.readBoundedRssWebhookRawBody(new Request("https://example.test/webhook", {
    method: "POST",
    headers: { "content-length": String(policy.MAX_RSS_WEBHOOK_BODY_BYTES + 1) },
  })),
  "rss_webhook_content_length_exceeded",
);
await expectCode(
  () => policy.readBoundedRssWebhookRawBody(new Request("https://example.test/webhook", {
    method: "POST",
    headers: { "content-encoding": "gzip" },
  })),
  "rss_webhook_content_encoding_blocked",
);

const oversizedStream = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(policy.MAX_RSS_WEBHOOK_BODY_BYTES));
    controller.enqueue(new Uint8Array([0x20]));
    controller.close();
  },
});
await expectCode(
  () => policy.readBoundedRssWebhookRawBody(new Request("https://example.test/webhook", {
    method: "POST",
    body: oversizedStream,
    duplex: "half",
  })),
  "rss_webhook_body_too_large",
);
const fragmentedStream = new ReadableStream({
  start(controller) {
    for (let index = 0; index <= policy.MAX_RSS_WEBHOOK_BODY_CHUNKS; index += 1) {
      controller.enqueue(new Uint8Array([0x20]));
    }
    controller.close();
  },
});
await expectCode(
  () => policy.readBoundedRssWebhookRawBody(new Request("https://example.test/webhook", {
    method: "POST",
    body: fragmentedStream,
    duplex: "half",
  })),
  "rss_webhook_body_chunk_limit_exceeded",
);
await expectCode(
  () => policy.readBoundedRssWebhookRawBody(new Request("https://example.test/webhook", {
    method: "POST",
    body: new Uint8Array([0xc3, 0x28]),
  })),
  "rss_webhook_body_text_invalid",
);
await expectCode(
  async () => policy.parseBoundedRssWebhookJson(
    `${"[".repeat(policy.MAX_RSS_WEBHOOK_JSON_DEPTH + 1)}0${"]".repeat(policy.MAX_RSS_WEBHOOK_JSON_DEPTH + 1)}`,
  ),
  "rss_webhook_json_depth_exceeded",
);
await expectCode(
  async () => policy.parseBoundedRssWebhookJson(
    `[${Array.from({ length: policy.MAX_RSS_WEBHOOK_JSON_NODES }, () => "0").join(",")}]`,
  ),
  "rss_webhook_json_node_limit_exceeded",
);
await expectCode(
  async () => policy.extractBoundedRssWebhookItems({
    items: Array.from({ length: policy.MAX_RSS_WEBHOOK_ITEMS + 1 }, () => ({})),
  }),
  "rss_webhook_item_limit_exceeded",
);
await expectCode(
  async () => policy.extractBoundedRssWebhookItems({
    items: [{
      enclosure: Array.from({ length: policy.MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM + 1 }, () => ({})),
    }],
  }),
  "rss_webhook_media_candidate_limit_exceeded",
);
assert.equal(policy.rssWebhookPayloadErrorStatus(new policy.RssWebhookPayloadError("rss_webhook_body_too_large")), 413);
assert.equal(policy.rssWebhookPayloadErrorStatus(new policy.RssWebhookPayloadError("rss_webhook_content_encoding_blocked")), 415);

let selfTest = "skipped";
if (process.env.MUTATION_TEST === "1") {
  const assertRejected = (label, mutate) => {
    assert.throws(
      () => validateStructural(mutate(sources)),
      undefined,
      `${label} mutation must fail the source contract`,
    );
  };
  assertRejected("RSS body byte cap", (source) => ({
    ...source,
    policy: source.policy.replace("MAX_RSS_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024", "MAX_RSS_WEBHOOK_BODY_BYTES = Number.MAX_SAFE_INTEGER"),
  }));
  assertRejected("RSS body chunk cap", (source) => ({
    ...source,
    policy: source.policy.replace("if (chunksRead > MAX_RSS_WEBHOOK_BODY_CHUNKS)", "if (false)"),
  }));
  assertRejected("pre-parse JSON depth guard", (source) => ({
    ...source,
    policy: source.policy.replace("assertBoundedJsonSyntax(rawBody, limits);", "assertSkippedJsonSyntax(rawBody, limits);"),
  }));
  assertRejected("bounded signed auth", (source) => ({
    ...source,
    auth: source.auth.replace("readBoundedRssWebhookBody(req.clone())", "req.clone().text()"),
  }));
  assertRejected("byte-preserving signed auth", (source) => ({
    ...source,
    auth: source.auth.replace("buildRssWebhookSignatureInput(parsed.timestamp, rawBodyBytes)", "new TextEncoder().encode(`${parsed.timestamp}.${rawBody}`)"),
  }));
  assertRejected("pre-buffer auth mode", (source) => ({
    ...source,
    webhook: source.webhook.replace("const authMode = readRssWebhookAuthMode(req);", "const authMode = 'signed';"),
  }));
  assertRejected("RSS shared-secret isolation", (source) => ({
    ...source,
    auth: source.auth.replace("readOptionalEnv('RSSAPP_WEBHOOK_TOKEN')", "readOptionalEnv('WEBHOOK_SHARED_SECRET') || readOptionalEnv('RSSAPP_WEBHOOK_TOKEN')"),
  }));
  assertRejected("webhook raw reader", (source) => ({
    ...source,
    webhook: source.webhook.replace("const boundedBody = await readBoundedRssWebhookBody(req);", "const boundedBody = await req.text();"),
  }));
  assertRejected("production HMAC byte forwarding", (source) => ({
    ...source,
    webhook: source.webhook.replace("        rawBodyBytes,\n", ""),
  }));
  assertRejected("bounded item extractor", (source) => ({
    ...source,
    webhook: source.webhook.replace("items = extractBoundedRssWebhookItems(payload);", "items = payloadAny.items;"),
  }));
  assertRejected("media parser candidate cap", (source) => ({
    ...source,
    itemParser: source.itemParser.replace("if (inspected.count >= MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM) return false;", "if (false) return false;"),
  }));
  assertRejected("invalid media candidates consume parser budget", (source) => ({
    ...source,
    itemParser: source.itemParser.replace(
      "inspected.count += 1;\n  if (!candidate) return true;",
      "if (!candidate) return true;\n  inspected.count += 1;",
    ),
  }));
  assertRejected("HTML scan attempt cap", (source) => ({
    ...source,
    itemParser: source.itemParser.replaceAll("if (tagAttempts >= MAX_RSS_WEBHOOK_HTML_TAG_ATTEMPTS_PER_ITEM) return;", "if (false) return;"),
  }));
  assertRejected("literal entity compatibility", (source) => ({
    ...source,
    itemParser: source.itemParser.replace("entityCandidate.length === 1 && !isRssEntityCharacter(char)", "false"),
  }));
  assertRejected("safe payload telemetry", (source) => ({
    ...source,
    webhook: source.webhook.replace("shape: payloadIsRecord ? 'object' : payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload,", "shape: typeof payload === 'object' && !Array.isArray(payload) ? Object.keys(payload as Record<string, unknown>) : typeof payload,"),
  }));
  selfTest = "pass";
}

console.log(`RSS_WEBHOOK_INPUT_POLICY_SOURCE_CONTRACT_PASS bodyBytes=${policy.MAX_RSS_WEBHOOK_BODY_BYTES} items=${policy.MAX_RSS_WEBHOOK_ITEMS} mediaCandidates=${policy.MAX_RSS_WEBHOOK_MEDIA_CANDIDATES_PER_ITEM} selfTest=${selfTest}`);
