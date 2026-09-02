import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const rendererSourceRoot = join(repoRoot, "services/video-renderer/src");
const paths = {
  runner: join(rendererSourceRoot, "processRunner.js"),
  ffmpeg: join(rendererSourceRoot, "ffmpeg.js"),
  preflight: join(rendererSourceRoot, "preflight.js"),
  server: join(rendererSourceRoot, "server.js"),
  renderer: join(rendererSourceRoot, "renderer.js"),
  preview: join(rendererSourceRoot, "preview.js"),
};
const source = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, readFileSync(path, "utf8")]));
const runnerTestFile = join(repoRoot, "services/video-renderer/test/processRunner.test.js");
const runnerTestSource = readFileSync(runnerTestFile, "utf8");
const cleanupTestFile = join(repoRoot, "services/video-renderer/test/processRunnerTempCleanup.test.js");
const cleanupTestSource = readFileSync(cleanupTestFile, "utf8");

function indexOfOrFail(value, needle, message) {
  const index = value.indexOf(needle);
  assert.ok(index >= 0, message);
  return index;
}

function rendererJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rendererJavaScriptFiles(path);
    return entry.name.endsWith(".js") ? [path] : [];
  });
}

function validateStructural(sources) {
  for (const [name, expected] of [
    ["probe", "60_000"],
    ["analysis", "180_000"],
    ["ocr", "120_000"],
    ["render", "1_800_000"],
  ]) {
    assert.match(sources.runner, new RegExp(`${name}: ${expected}`), `${name} must retain a fixed stage deadline`);
  }
  assert.match(sources.runner, /DEFAULT_PROCESS_TERMINATION_GRACE_MS = 10_000/, "TERM grace must remain bounded");
  assert.match(sources.runner, /DEFAULT_PROCESS_TERMINATION_SETTLE_MS = 5_000/, "post-KILL settle must remain bounded");
  assert.match(sources.runner, /MAX_PROCESS_TEXT_STDOUT_BYTES = 256 \* 1024/, "text stdout must retain a cap");
  assert.match(sources.runner, /MAX_PROCESS_STDERR_TAIL_BYTES = 64 \* 1024/, "stderr tail must retain a cap");
  assert.match(sources.runner, /MAX_PROCESS_BINARY_STDOUT_BYTES = 32 \* 1024 \* 1024/, "binary stdout must retain a cap");
  assert.match(sources.runner, /stderrTailBytes/, "managed errors must retain only safe stderr size diagnostics");
  assert.doesNotMatch(sources.runner, /this\.stderrTail\s*=/, "managed errors must not carry raw stderr into telemetry paths");
  assert.match(sources.runner, /detached: settings\.detached/, "managed commands must opt into a process-group-capable spawn mode");
  assert.match(sources.runner, /processImpl\.kill\(-pid, signal\)/, "Linux descendants must be signalled through their process group");
  assert.match(sources.runner, /signalChild\(child, "SIGTERM", settings\)/, "managed commands must begin termination with SIGTERM");
  assert.match(sources.runner, /signalChild\(child, "SIGKILL", settings\)/, "managed commands must escalate to SIGKILL");
  assert.match(sources.runner, /runManagedPipeline/, "pipeline commands must use the shared lifecycle abstraction");
  assert.match(sources.runner, /abortAllManagedProcesses/, "active commands must be discoverable during shutdown");
  assert.match(sources.runner, /MANAGED_PROCESS_SHUTDOWN_REQUESTED/, "shutdown must latch the runner against later subprocess stages");
  assert.match(sources.runner, /abortSignal: readAbortSignal\(options\.signal\)/, "managed runners must accept a caller abort signal");
  assert.match(sources.runner, /addEventListener\("abort", abortListener/, "managed runners must react to abort signals");
  assert.match(
    sources.runner,
    /if \(afterConsumerCancellation\) \{\s*(?:\/\/[^\n]*\n\s*)*terminate\(afterConsumerCancellation\);\s*return;/,
    "pipeline must re-check cancellation and signal after consumer spawn",
  );
  assert.doesNotMatch(sources.runner, /shell:\s*true/, "managed runner must never introduce a shell");
  assert.match(sources.ffmpeg, /runManagedCommand/, "ffmpeg commands must route through the managed runner");
  assert.match(sources.ffmpeg, /runManagedPipeline/, "OpenCV pipeline must route through the managed runner");
  assert.doesNotMatch(sources.ffmpeg, /from "node:child_process"/, "ffmpeg must not retain a direct spawn import");
  assert.match(sources.preflight, /runManagedCommand/, "OCR/preflight commands must route through the managed runner");
  assert.doesNotMatch(sources.preflight, /from "node:child_process"/, "preflight must not retain a direct spawn import");
  assert.match(sources.preflight, /processFailureCode/, "OCR failures must expose safe runner codes rather than raw process output");
  assert.match(sources.renderer, /stage: "render"/, "main encode path must use render deadline");
  assert.match(sources.preview, /stage: "render"/, "preview encode path must use render deadline");

  // BOTH production per-row cleanup paths (processRenderRow and
  // runPreflightForRenderId) must tear down their OWNED working directory via
  // the shared production seam `removeOwnedWorkdir`, and only that seam. A
  // direct rm, or a seam call aimed at the shared parent (runtimeConfig.workDir)
  // / bare parent, would silently stop testing the identical behaviour that the
  // E2 filesystem fixture covers — and could leak-owned cleanup into the parent.
  // We require each argument to be the LOCAL `workingDir` variable, and forbid
  // any parent-targeted call. The count/arity is validated so a first removed
  // site cannot hide behind a second still-present one.
  const rendererFinallyCleanup = [...sources.renderer.matchAll(/\bawait removeOwnedWorkdir\(([A-Za-z_$][A-Za-z0-9_$]*)\)/g)];
  assert.ok(
    rendererFinallyCleanup.length >= 2,
    "renderer must route BOTH production cleanup paths through the removeOwnedWorkdir seam",
  );
  for (const call of rendererFinallyCleanup) {
    assert.equal(
      call[1],
      "workingDir",
      "production cleanup must remove the exact local workingDir, never a parent/parent-derived path",
    );
  }
  assert.doesNotMatch(
    sources.renderer,
    /\brm\(workingDir\b|removeOwnedWorkdir\((runtimeConfig\.workDir|row\.id|root|parent|store)\)/,
    "production cleanup must never direct a bare rm or the seam at a parent/derived path",
  );
  assert.doesNotMatch(
    sources.renderer,
    /removeOwnedWorkdir\(join\(/,
    "production cleanup must pass the exact local workingDir, never a join-derived parent",
  );

  const shutdownStopIndex = indexOfOrFail(sources.server, "capacityGate.stopAccepting();", "shutdown must stop accepting work");
  const abortIndex = indexOfOrFail(sources.server, 'abortAllManagedProcesses("shutdown")', "shutdown must request active child cancellation");
  const drainIndex = indexOfOrFail(sources.server, "await capacityGate.waitForDrain(graceMs)", "shutdown must retain capacity drain observation");
  assert.ok(shutdownStopIndex < abortIndex && abortIndex < drainIndex, "shutdown must signal managed child groups before capacity drain observation");

  for (const path of rendererJavaScriptFiles(rendererSourceRoot)) {
    const relative = path.slice(repoRoot.length + 1);
    const contents = readFileSync(path, "utf8");
    assert.doesNotMatch(contents, /\bspawn\(/, `${relative} must not bypass the shared runner with direct spawn`);
    assert.doesNotMatch(contents, /shell:\s*true/, `${relative} must not introduce shell execution`);
  }
}

function validateRunnerRejectRaceGuard(testSrc) {
  // Every fixture that creates an early-failing REAL child promise must attach a
  // rejection observer synchronously, BEFORE any PID/ready-file wait or
  // assert.rejects registration. Without that, the runner's short deadline can
  // reject the promise while the test body is still awaiting readPidFile, and
  // the unobserved rejection surfaces to Node as an unhandledRejection that
  // fails the whole test with `failureType: 'unhandledRejection'` even though
  // readPidFile and the deadline both behaved correctly. This is the exact
  // intermittent default-suite failure the rejection race previously produced.
  //
  // We require the helper to be invoked WITHOUT `await` (call line must not start
  // with `await observeRejections`) — an awaited call would block on settlement
  // and hang fixtures whose child only rejects later (e.g. the external-abort
  // test). Each invocation is also required to sit on its own line immediately
  // after the runManagedCommand/pipeline that created the promise. Five distinct
  // fixtures must be guarded: hung-timeout, group-escaltion, stdout-overflow,
  // stderr-secret, and external-abort.
  const guardLines = [...testSrc.matchAll(/^[ \t]*(observeRejections)\(promise\);?$/gm)];
  assert.ok(
    guardLines.length >= 5,
    `runner tests must observe incoming rejections on at least 5 early-failing fixtures (found ${guardLines.length})`,
  );
  // The guard must fire immediately before the promise is awaited indirectly
  // (readPidFile / ready-file wait). Proving exact per-fixture placement is
  // brittle, so we additionally require every observe call be a bare
  // not-await'ed statement. The 5+ call-count combined with the never-await
  // rule is the mutation-resilient invariant.
  for (const line of guardLines) {
    assert.doesNotMatch(
      line[0],
      /await observeRejections/,
      "rejection observer must be attached synchronously, never awaited",
    );
  }
  assert.match(
    testSrc,
    /function observeRejections\(promise\)\s*\{[^}]*promise\.catch\(\(\) => \{\}\);/,
    "runner tests must define an observeRejections helper that attaches a no-op catch immediately",
  );
}

// ---------------------------------------------------------------------------
// Executable-source masker.
//
// A line-anchored `^[ \t]*<statement>` proof is comment-sneak-resistant only if
// the lines it can match are ACTUALLY executable source. A single-line `//`
// comment, `"` string, or single-line `/* */` is already excluded by the anchor
// itself: such a line opens with `//`, `"`, or `'`, which can never prefix the
// identifier/`const`/`if`/`return` that a live-statement pattern anchors on. The
// two regions that CAN present an interior line as statement-initial are the
// MULTILINE block comment and the MULTILINE template literal — the exact decoy
// surfaces the reviewer reproduced. We therefore materialize a same-length copy
// of the source in which only those two spans — block-comment bodies and all
// template-literal text (raw text and `${…}` alike) — are blanked to spaces,
// preserving every offset and newline. Strings, line comments, regex and normal
// code are left verbatim so a real `import { … node:child_process }` proof (a
// string-holding line) still resolves. A statement that merely appears inside a
// blanked region (dead variable, template-literal userland child script, or dead
// comment) never qualifies the LIVE anchor, so a decoy cannot resurrect a
// removed invariant — and this is exactly the reviewer's five reproductions.
// ---- Same-length context-aware lexical scanner -----------------------------
//
// A statement-anchored `^[ \t]*<proof>` is only meaningful if the lines it can
// match are ACTUALLY executable source. A single-line `//` comment, a `"`/`'`
// string, or a single-line `/* */` block comment is already excluded by the
// anchor (such a line opens with `//`, `"`/`'`, or `/*`, none of which prefix
// the `const`/`if`/`return`/`import` a live-statement proof anchors on). The
// regions that CAN present an interior line as statement-initial are the
// MULTILINE block comment and the MULTILINE template literal — the exact decoy
// surfaces the reviewer reproduced.
//
// Unlike the prior implementation, this scanner is a CONTEXT-AWARE lexical
// state machine: it recognizes line comments (`//`), block comments (`/* … */`),
// single- and double-quoted strings, regex literal bodies + flags, and template
// raw text, blanking every non-executable region to spaces while PRESERVING newlines
// and offsets (same byte length). Executable code inside `${…}` template
// interpolation is left visible so a decoy cannot smuggle a fake statement
// via a template, while raw template text stays blanked. Regex keeps / escapes,
// character classes, and flags verbatim-in-body but masked when complete.
//
// Strings, line comments and normal code are left verbatim in the OUTPUT only
// insofar as they are real executable code; the masker blanks *literal* spans
// (strings, comments, template text, regex). This keeps a real `import { … }`
// proof (a string-holding line) resolvable while making decoy text inside ANY
// literal or comment non-anchoring. Division vs regex is disambiguated by the
// state of the previous non-whitespace token; escapes, `[...]` classes, template
// nested `{}` and `${}` are handled by the nested-brace depth tracking below.
// Scan one run of EXECUTABLE source, blanking (to spaces, preserving newlines
// and offsets) every non-executable span — line comments, block comments,
// single-/double-quoted strings, regex literals, and template raw text — while
// leaving real code (including the code inside a `${…}` template expression)
// visible. It is a context-aware lexical state machine plus a minimal
// token-class lattice that distinguishes `/`-opens-a-regex from `/`-division:
// after a delimiter/keyword the `/` begins a regex literal; after an operand it
// is division. Strings and templates are self-terminating, so a decoy delimiter
// (`//`, `` ` ``) inside a string or regex body can never flip the scanner into
// a false state. Template interpolation is handled with a brace-depth recursion
// so nested `{…}`, nested templates, and the closing `${…}`  brace are balanced
// correctly while the expression's own code stays unscanned.
function maskNonExecutable(source) {
  const out = Array.from(source);
  const n = source.length;
  const blank = (j) => { if (j >= 0 && j < n && out[j] !== "\n") out[j] = " "; };
  const blankSpan = (a, b) => { for (let j = a; j < b && j < n; j += 1) blank(j); };

  // Blank the regex literal whose opening `/` sits at `at`. Handles `\` escapes,
  // `[...]` character classes, and trailing /flags. A JS regex literal cannot
  // legally contain a raw newline, but the mutation mode feeds the masker
  // ARBITRARY TEXT (constructed strings, never executed as JS) that may attempt
  // an interior-line decoy; so we keep scanning across newlines until the closing
  // `/`, blanking the whole span (newlines survive via `blank`). This is a pure
  // defensive closure: for any VALID regex the terminator already precedes a
  // newline, so behaviour is unchanged on the real fixtures. If no closing `/`
  // is ever found we treat it as division and advance one char.
  const blankRegex = (at) => {
    let k = at + 1;
    let inClass = false;
    for (;;) {
      if (k >= n) return at + 1; // no closing `/`: fall back to division
      const ch = source[k];
      if (ch === "\\") { k += 2; continue; }
      if (inClass) { if (ch === "]") inClass = false; k += 1; continue; }
      if (ch === "[") { inClass = true; k += 1; continue; }
      if (ch === "/") { k += 1; break; }
      k += 1; // includes newlines (interior raw-line decoy text); blank skips "\n"
    }
    while (k < n && /[A-Za-z]/.test(source[k])) k += 1; // flags
    blankSpan(at, k);
    return k;
  };

  // Scan executable code from `start`. When `inTemplateExpression` is truthy the
  // scan stops at the matching closing `}` of the `${…}` that called it (the
  // caller consumes that `}`) and returns the index just AFTER it. Blanking of
  // every literal/comment span is done inline, so a `}` or delimiter inside a
  // string/comment/template/regex can never flip the scanner into a false state.
  const scanCode = (start, inTemplateExpression) => {
    let i = start;
    let prevWasWord = false;
    // depth counts the open `${…}` braces INSIDE an expression. The caller that
    // invoked scanCode for a `${` (or the initial top-level run) has already
    // established the opening brace; we start at 1 for an expression so the
    // `}` that brings us back to depth 0 is the EXACT expression terminator.
    let depth = inTemplateExpression ? 1 : 0;
    while (i < n) {
      const c = source[i];

      // Template expression brace balancing. Track with the same scanner so a
      // `}` inside a nested comment/string/template/regex can never terminate the
      // expression; only a real, depth-balancing `}` at the correct nesting level
      // returns control to the template raw-text loop (consuming that `}`).
      if (inTemplateExpression) {
        if (c === "{") { depth += 1; i += 1; continue; }
        if (c === "}") {
          depth -= 1;
          i += 1;
          if (depth === 0) return i; // past the expression's closing `}`
          continue;
        }
      }

      if (c === " " || c === "\t" || c === "\n" || c === "\r") { i += 1; continue; }

      if (c === "/" && source[i + 1] === "/") {
        while (i < n && source[i] !== "\n") { blank(i); i += 1; }
        prevWasWord = false;
        continue;
      }
      if (c === "/" && source[i + 1] === "*") {
        blank(i); blank(i + 1); i += 2;
        while (i < n && !(source[i] === "*" && source[i + 1] === "/")) {
          if (source[i] !== "\n") blank(i);
          i += 1;
        }
        if (i < n) { blank(i); blank(i + 1); i += 2; }
        prevWasWord = false;
        continue;
      }

      if (c === "'" || c === '"') {
        const q = c;
        blank(i); i += 1;
        while (i < n) {
          const t = source[i];
          if (t === "\\") { blank(i); if (i + 1 < n) blank(i + 1); i += 2; continue; }
          if (t === q) { blank(i); i += 1; break; }
          blank(i); i += 1;
        }
        prevWasWord = true;
        continue;
      }

      if (c === "`") {
        i += 1;
        for (;;) {
          if (i >= n) break;
          const t = source[i];
          if (t === "\\") { blank(i); if (i + 1 < n) blank(i + 1); i += 2; continue; }
          if (t === "`") { i += 1; break; }
          if (t === "$" && source[i + 1] === "{") {
            blank(i); blank(i + 1); i += 2; // blank `${`; keep the expression body visible
            i = scanCode(i, true);           // consume expression code + its closing `}`
            continue;
          }
          if (t !== "\n") blank(i);
          i += 1;
        }
        prevWasWord = true;
        continue;
      }

      if (c === "/") {
        if (prevWasWord) { i += 1; prevWasWord = false; continue; } // division
        i = blankRegex(i);                                            // regex literal
        prevWasWord = true;
        continue;
      }

      // A whole identifier run must be consumed as ONE token and classified
      // before the `/`-context decision is made. A keyword such as `return` or
      // `typeof` leaves the NEXT token in operand-start position, so a `/` that
      // follows it opens a REGEX literal; any other identifier is itself an
      // operand (so a following `/` is division). Reading the whole run in one
      // step is what makes this sound: the OLD code classified char-by-char, so
      // the leading `r` of `return` hit the generic `\w` operand branch and set
      // prevWasWord=true BEFORE the keyword branch ever recognised it — turning a
      // `/` after `return` into division, after which that regex's opening
      // backtick opened a false template state and blanked the live tail.
      if (/[A-Za-z_]/.test(c)) {
        const start = i;
        while (i < n && /[A-Za-z0-9_$]/.test(source[i])) i += 1;
        // A keyword (return/typeof/…) only leaves operand-start position when it
        // is a STATEMENT keyword, not when it is a property name on a member
        // access (obj.delete / opts.of under a trailing `/` are division, not a
        // regex literal). We decide the member-access form by the nearest
        // preceding non-whitespace char being `.` (also covers `?.`).
        let dotBefore = false;
        for (let j = start - 1; j >= 0; j -= 1) {
          const p = source[j];
          if (p === " " || p === "\t" || p === "\n" || p === "\r") continue;
          dotBefore = p === ".";
          break;
        }
        // `throw`, `await`, and `instanceof` are, like `return`/`typeof`,
        // keyword/operator tokens that leave the NEXT token in operand-start
        // position, so a `/` that follows one opens a REGEX literal, not
        // division. A `throw /regex/`, `await /regex/`, or `x instanceof
        // /regex/` whose regex body carries a backtick must be masked as a
        // whole literal — otherwise the opening backtick starts a false
        // template state that blanks the entire live tail. The `.`-before
        // guard still treats member-access forms (`obj.throw`, `a.instanceof`)
        // as operands (so a `/` after them is division), preserving property
        // names.
        const isKeyword =
          !dotBefore &&
          /^(?:return|typeof|in|of|new|case|void|delete|do|else|if|for|while|switch|with|yield|throw|await|instanceof)$/.test(
            source.slice(start, i),
          );
        prevWasWord = !isKeyword;
        continue;
      }
      if (/[\w)\].]/.test(c) || (c === "-" && /[\w)\]]/.test(source[i + 1] ?? ""))) {
        prevWasWord = true;
      } else if (/[(\[{,;:}=!&|?+\-*%<>^~]/.test(c)) {
        // Delimiter / operator / opener: the NEXT token starts an operand, so a
        // `/` that follows is a regex literal start, not division. `;`, `:`, `}`
        // are all value-delimiters in the same way as `,` and `(`.
        prevWasWord = false;
      } else {
        prevWasWord = true;
      }
      i += 1;
    }
    return i;
  };

  scanCode(0, false);
  return out.join("");
}

// Return the whole line (without its trailing newline) whose FIRST
// non-whitespace content begins with `pattern` when searched over the
// executable-only (masked) view of `src`, or null if no such line exists.
// Anchoring to the START of a line is what makes a check
// comment-sneak-resistant; masking every non-executable region makes that
// anchor meaningful even for a MULTILINE block comment or template literal,
// whose interior lines would otherwise present as statement-initial. A
// statement that merely appears as a sub-string elsewhere (dead variable name,
// template-literal userland child script, or dead comment) never qualifies, so
// decoy text cannot resurrect a removed invariant.
function liveLineMatch(src, pattern) {
  // Match on the executable-only view so multiline block-comment / template
  // interior decoys cannot satisfy the anchor; the mask is same-length and
  // newline-preserving, so match.index is ALSO the real-source offset of the
  // LIVE line. We return that offset alongside the line (sliced from the REAL
  // source, not the masked) so a caller can bound a semantic region from the
  // masked-match position directly — never a raw unmasked substring search,
  // which an earlier template/block-comment decoy of identical text would win.
  const masked = maskNonExecutable(src);
  const match = masked.match(new RegExp(`^[ \\t]*${pattern}`, "m"));
  if (!match) return null;
  const lineEnd = src.indexOf("\n", match.index);
  const line = src.slice(match.index, lineEnd === -1 ? src.length : lineEnd);
  return { line, index: match.index };
}

function liveLineOf(src, pattern) {
  const r = liveLineMatch(src, pattern);
  return r ? r.line : null;
}

function assertLiveLine(src, pattern, label) {
  const line = liveLineOf(src, pattern);
  assert.ok(
    line !== null,
    `${label} (required as LIVE code at the start of a line, never inside a comment or decoy string)`,
  );
  return line;
}

function validateCapturePlacementGuard(testSrc) {
  // ---------------------------------------------------------------------------
  // The child-startup-vs-deadline evidence race is deterministic now. The E2
  // failure being repaired: under full-suite host load the runner's short
  // managed deadline can fire a slow real child BEFORE its userland ran, so a
  // fixture that waited asynchronously for a user PID/ready file after calling
  // runManagedCommand would time out spuriously because the production timer may
  // already be running by then.
  //
  // The fix lives INSIDE the narrow test-only spawn seam `liveSpawn`.
  // runManagedCommand installs its termination timer only AFTER spawnImpl
  // returns, so a seam that blocks SYNCHRONOUSLY (Atomics.wait + bounded lstat
  // loop) until the child publishes an explicit ready marker defers the timer
  // until the child is demonstrably ready. Each proof below is tied to a
  // SEMANTIC NEIGHBOURHOOD (the seam's own body; a fixture's own block) — never
  // to brittle whole-file line numbers — and each proof must be a LIVE line at
  // the start of its own line, so commenting, neutralizing, or deleting any of
  // them drops the proof.
  // ---------------------------------------------------------------------------

  // (A) The seAM must import the REAL node:child_process spawn to wrap. The
  // live anchor matches the import's executable head (the identifier list and
  // `from`) up to — but not including — the module-specifier string, which the
  // context-aware masker (by design) blanks. We therefore anchor on the live
  // import head, then confirm the REAL line names `node:child_process`, so a
  // decoy to some other module can never satisfy the proof.
  const importLine = assertLiveLine(
    testSrc,
    'import\\s*\\{[^}]*spawn\\s+as\\s+nodeSpawn[^}]*\\}\\s*from\\s',
    "runner tests must import the real nodeSpawn to wrap as the spawn seam",
  );
  assert.match(
    importLine,
    /from\s*"node:child_process"/,
    "runner tests must import nodeSpawn specifically from node:child_process",
  );

  // (B) Isolate the seam's own body so the spawn-forwarding / pid-capture /
  // ready-gate proof cannot be satisfied by a look-alike fixture elsewhere.
  // The boundary lines are located in the executable-only (masked) view so a
  // `function liveSpawn(` or `return capture;` decoy inside a comment / template
  // cannot mis-anchor the seam region; indices are preserved so they slice the
  // real source.
  assertLiveLine(testSrc, "function\\s+liveSpawn\\s*\\(", "runner tests must define a liveSpawn seam function");
  const seamMasked = maskNonExecutable(testSrc);
  const seamStart = seamMasked.indexOf("function liveSpawn(");
  const seamEnd = seamMasked.indexOf("return capture;", seamStart);
  assert.ok(seamStart >= 0 && seamEnd > seamStart, "liveSpawn seam must terminate by returning its capture handle");
  assert.ok(seamMasked.indexOf("return capture;", seamEnd + 1) < 0, "liveSpawn must have exactly ONE live capture-return boundary");
  const seam = testSrc.slice(seamStart, seamEnd);

  // (C) The seam must spawn a REAL child through the wrapped nodeSpawn with the
  // caller's exact bin/args/options, never a fake.
  assertLiveLine(seam, "capture\\.spawnImpl\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{", "seam must expose spawnImpl");
  assertLiveLine(
    seam,
    "const\\s+child\\s*=\\s*nodeSpawn\\s*\\(\\s*bin\\s*,\\s*args\\s*,\\s*options\\s*\\)\\s*;",
    "seam must forward the REAL nodeSpawn with the caller's bin/args/options",
  );

  // (D) The seam must capture that real child's pid SYNCHRONOUSLY at spawn (a
  // trailing userland read cannot legally satisfy the evidence bind).
  assertLiveLine(seam, "capture\\.pid\\s*=\\s*child\\.pid\\s*;", "seam must capture child.pid synchronously at spawn");

  // (E) The seam must gate readiness on the ACTUAL `readyFile` ARGUMENT through a
  // bounded waitForFileSync call inside spawnImpl — never `false`, never a decoy
  // or differently-named variable, before returning the child.
  assertLiveLine(
    seam,
    "if\\s*\\(\\s*readyFile\\s*&&\\s*!waitForFileSync\\s*\\(\\s*readyFile\\s*,\\s*readyTimeoutMs\\s*\\)\\s*\\)\\s*\\{",
    "seam must gate readiness on the ACTUAL readyFile argument via waitForFileSync (never a decoy, never `false`)",
  );
  assertLiveLine(seam, "return\\s+child\\s*;", "seam must return the SAME real child");

  // (F) Ordering INSIDE spawnImpl: the pid capture immediately after spawn; the
  // ready gate raised AFTER the pid is bound and BEFORE `return child`, so the
  // production timer only starts once the child is demonstrably ready. This is
  // deliberately LINE-ANCHORED over the MASKED view, not a bare substring offset:
  // each of the four seam statements must exist as a LIVE line (a comment/decoy
  // line is blanked and returns null / is skipped), and their causal order is
  // enforced on the MASKED match indices — so the ordering proof cannot be
  // satisfied by a template/comment decoy that reproduces one of them at an
  // earlier offset.
  const maskedSeam = maskNonExecutable(seam);
  const liveLineIdx = (pattern) => {
    const match = maskedSeam.match(new RegExp(`^[ \\t]*${pattern}`, "m"));
    return match ? match.index : -1;
  };
  const spawnAt = liveLineIdx("const\\s+child\\s*=\\s*nodeSpawn\\s*\\(\\s*bin\\s*,\\s*args\\s*,\\s*options\\s*\\)");
  const pidAt = liveLineIdx("capture\\.pid\\s*=\\s*child\\.pid\\s*;");
  const gateAt = liveLineIdx("if\\s*\\(\\s*readyFile\\s*&&\\s*!waitForFileSync\\s*\\(\\s*readyFile\\s*,\\s*readyTimeoutMs\\s*\\)");
  const retAt = liveLineIdx("return\\s+child\\s*;");
  assert.ok(pidAt >= 0 && pidAt > spawnAt, "seam must bind child.pid immediately AFTER the real spawn (both as LIVE lines)");
  assert.ok(gateAt >= 0 && gateAt > pidAt, "seam must raise the readyFile gate AFTER the pid is bound (live lines)");
  assert.ok(retAt >= 0 && retAt > gateAt, "seam must not return the child until the readyFile gate has completed (live lines)");

  // (G) The wait helper must be BOUNDED by a Date.now clock deadline and must
  // probe REAL filesystem existence (never a Promise-fake or an unbounded busy
  // loop masquerading as a ready marker).
  assertLiveLine(
    testSrc,
    "function\\s+waitForFileSync\\s*\\(\\s*path\\s*,\\s*timeoutMs\\s*\\)\\s*\\{",
    "runner tests must define a bounded waitForFileSync helper",
  );
  assertLiveLine(
    testSrc,
    "while\\s*\\(\\s*Date\\.now\\s*\\(\\s*\\)\\s*<\\s*deadline\\s*\\)\\s*\\{",
    "waitForFileSync must be bounded by a Date.now clock deadline",
  );
  assertLiveLine(
    testSrc,
    "try\\s*\\{\\s*if\\s*\\(\\s*existsSync\\s*\\(\\s*path\\s*\\)\\s*\\)\\s*return\\s*true\\s*;",
    "waitForFileSync must probe real filesystem existence, never a fake pending",
  );

  // (H) Per-fixture placement-proof. Each affected fixture must (1) declare its
  // evidence from a LIVE liveSpawn seam, (2) gate on a real readyFile marker
  // where readiness matters, (3) route its runManaged spawn through THAT seam,
  // (4) bind its evidence PID to the synchronous in-seam capture, and (5) assert
  // the readiness marker where applicable. Overflow stays PID-only. Each
  // fixture's evidence block is ITS OWN semantic neighbourhood (from its seam
  // declaration to the next top-level `test(...)`), not a whole-file line number.
  const fixtures = [
    { name: "hung", var: "hung", pidVar: "pid", ready: true },
    { name: "overflow", var: "overflow", pidVar: "pid", ready: false },
    { name: "secret", var: "sec", pidVar: "pid", ready: true },
    { name: "abort", var: "ab", pidVar: "pid", ready: true },
    { name: "group", var: "group", pidVar: "leadPid", ready: true },
  ];
  for (const fix of fixtures) {
    // Capture the masked-live-match OFFSET, not a raw unmasked substring
    // search: an earlier multiline template / block-comment decoy with a
    // byte-identical `const X = liveSpawn(` survives in the UN-masked source,
    // so `testSrc.indexOf(declLine)` would win the decoy and drop the real
    // fixture body out of its own evidence region. The mask's same-length
    // index is the real LIVE declaration's position; the semantic region must
    // be bound from it (never re-located by indexOf over raw text).
    const decl = liveLineMatch(
      testSrc,
      `const\\s+${fix.var}\\s*=\\s*liveSpawn\\s*\\(`,
    );
    assert.ok(
      decl !== null,
      `fixture "${fix.name}" must declare a LIVE liveSpawn seam binding (required as LIVE code at the start of a line, never inside a comment or decoy string)`,
    );
    const declLine = decl.line;
    if (fix.ready) {
      assert.match(
        declLine,
        /readyFile\s*:\s*[A-Za-z_$][A-Za-z0-9_$]*\s*,/,
        `fixture "${fix.name}" must pass the readyFile marker into its liveSpawn seam`,
      );
    } else {
      assert.doesNotMatch(
        declLine,
        /readyFile\s*:/,
        `fixture "${fix.name}" is PID-only and must not gain a readyFile gate`,
      );
    }
    // The fixture's OWN evidence block runs from that seam declaration to the
    // next top-level `test(...)` — a semantic neighbourhood, not a line number.
    // bound from the MASKED-live-match offset, so an earlier decoy can never
    // shift the region away from the real fixture body.
    const declIdx = decl.index;
    const regionStart = testSrc.lastIndexOf("\n", declIdx) + 1;
    const tail = testSrc.slice(regionStart);
    const nextTest = tail.search(/^[ \t]*test\(/m);
    const region = tail.slice(0, nextTest === -1 ? tail.length : nextTest);

    assertLiveLine(
      region,
      `spawnImpl\\s*:\\s*${fix.var}\\.spawnImpl`,
      `fixture "${fix.name}" must route its runManaged spawn through the SAME liveSpawn seam`,
    );
    assertLiveLine(
      region,
      `${fix.pidVar}\\s*=\\s*${fix.var}\\.pid\\s*;`,
      `fixture "${fix.name}" must bind its evidence PID to the synchronous in-seam capture`,
    );
    if (fix.ready) {
      assertLiveLine(
        region,
        `assert\\.ok\\s*\\(\\s*${fix.var}\\.ready\\b`,
        `fixture "${fix.name}" must assert its readiness marker is published before the timer starts`,
      );
    }
  }
}

function validateRunnerTestFidelity(runnerSrc, testSrc) {
  // The fast-path success child must be built from a REAL local child Node
  // process — never a fake — so the ecosystem-level contract is exercised.
  assert.match(
    testSrc,
    /bin: process\.execPath, args: \["-e", script\]/,
    "runner tests must spawn a real child Node process for success coverage",
  );
  // The group-escape fixture must prove TERM->KILL escalation reaches a
  // descendant that shares the leader's process group.
  assert.ok(
    testSrc.includes("process.on(\"SIGTERM\", () => {})") && testSrc.includes("POST-DEADLINE"),
    "runner tests must prove a SIGTERM-ignoring descendant is group-killed before a late line runs",
  );
  // The group-escape fixture must PROVE, by direct assertion, that the
  // SIGTERM-ignoring grandchild's own PID is gone AND that the leader's whole
  // process group is gone. Two independent live polls, each naming the exact
  // pid it reaps. The grandchild poll is the proof that group-KILL reached the
  // descendant; the leader group poll is the proof the leader session/group was
  // not left behind. A test that merely mentions pollPidGone / -pid somewhere
  // (e.g. the helper's own `-pid` fallback) does NOT prove either.
  //
  // Each assertion must be LIVE code on its own line — never sitting inside a
  // comment. Anchoring the call to the start of a line (after leading
  // whitespace) rules out `// assert.ok(await pollPidGone(...))` comment-sneak,
  // which a bare substring match would accept. The `m` flag makes ^ match line
  // boundaries. We bind to both literal call forms so either proof being
  // removed — or commented out — fails the contract.
  assert.match(
    testSrc,
    /^[ \t]*assert\.ok\(await pollPidGone\(gChildPid\)/m,
    "runner tests must directly assert the grandchild PID is reaped after the group KILL",
  );
  assert.match(
    testSrc,
    /^[ \t]*assert\.ok\(await pollPidGone\(leadPid, \{ group: true \}\)/m,
    "runner tests must directly assert the leader process group is gone after escalation",
  );
  // The owned temp-root fixture must prove cleanup cannot reach an unrelated
  // sibling sentinel that lives in the parent but outside the owned root.
  assert.ok(
    testSrc.includes("sibling-sentinel") && testSrc.includes("parent") && testSrc.includes("owned"),
    "runner tests must prove owned temp-root cleanup can never remove an unrelated sibling",
  );
}

function validateCleanupTestFidelity(testSrc) {
  // The E2 filesystem test MUST exercise the renderer's OWN production cleanup
  // seam, never a re-implemented direct rm. Replacing the helper invocation with
  // a bare rm (or with an unsafe parent-directory delete) would silently stop
  // testing the production finally path — the exact regression the reviewer
  // flagged in the rejected author's E2 scope.
  assert.match(
    testSrc,
    /import \{ removeOwnedWorkdir \} from "\.\.\/src\/renderer\.js";/,
    "cleanup tests must import the production cleanup seam from renderer.js",
  );

  // The seam must be invoked to remove the OWNED tree. A decoy call on an
  // ephemeral/never-owned path (e.g. removeOwnedWorkdir(join(store,"no-such")))
  // would satisfy the import+invoke guards without exercising real cleanup, so
  // we require the seam to be passed one of the owned working-dir variables.
  const ownedCalls = [...testSrc.matchAll(/removeOwnedWorkdir\(([A-Za-z_$][A-Za-z0-9_$]*)\)/g)]
    .map((m) => m[1]);
  assert.ok(
    ownedCalls.some((arg) => arg === "workingDir" || arg === "dropped"),
    "cleanup tests must invoke the production seam on an owned tree (workingDir/dropped), not a decoy path",
  );

  // No bare fs rm may ever delete the owned workingDir — that would bypass the
  // production seam. This must be robust to whitespace/reordering, so we compare
  // after normalizing (strip whitespace) and require the call to reference
  // workingDir with recursive+force.
  const compact = testSrc.replace(/\s+/g, "");
  assert.doesNotMatch(
    compact,
    /rm\(workingDir,\{recursive:true,force:true\}\)/,
    "cleanup tests must not delete the owned workingDir via a bare rm",
  );
  assert.doesNotMatch(
    compact,
    /removeOwnedWorkdir\((store|root|parent)\)/,
    "cleanup tests must never point the production seam at a parent directory",
  );
}

validateStructural(source);
validateRunnerRejectRaceGuard(runnerTestSource);
validateCapturePlacementGuard(runnerTestSource);
validateRunnerTestFidelity(source.runner, runnerTestSource);
validateCleanupTestFidelity(cleanupTestSource);

const runner = await import(new URL("../services/video-renderer/src/processRunner.js", import.meta.url));

function makeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killCalls = [];
  child.kill = (signal) => {
    child.killCalls.push(signal);
    return true;
  };
  return child;
}

function fakeRuntime(children, { closeOnKill = true } = {}) {
  const childByPid = new Map(children.map((child) => [child.pid, child]));
  const groupSignals = [];
  const spawnOptions = [];
  let cursor = 0;
  return {
    spawnImpl: (_bin, _args, options) => {
      spawnOptions.push(options);
      const child = children[cursor];
      cursor += 1;
      if (!child) throw new Error("unexpected fake spawn");
      return child;
    },
    processImpl: {
      platform: "linux",
      kill(pid, signal) {
        groupSignals.push({ pid, signal });
        const child = childByPid.get(Math.abs(pid));
        if (closeOnKill && child && signal === "SIGKILL") {
          queueMicrotask(() => child.emit("close", null, "SIGKILL"));
        }
      },
    },
    groupSignals,
    spawnOptions,
  };
}

const successChild = makeChild(101);
const successRuntime = fakeRuntime([successChild]);
const success = runner.runManagedCommand({ bin: "ffprobe", args: ["--version"] }, {
  label: "fixture_success",
  stage: "probe",
  spawnImpl: successRuntime.spawnImpl,
  processImpl: successRuntime.processImpl,
});
successChild.stdout.end("ok");
successChild.stderr.end();
successChild.emit("close", 0, null);
const successResult = await success;
assert.equal(successResult.code, 0, "managed success must preserve the exit code");
assert.equal(successResult.signal, null, "managed success must preserve the signal contract");
assert.equal(successResult.stdout, "ok", "managed success must preserve bounded text output");
assert.equal(successResult.stderr, "", "managed success must preserve bounded stderr output");
assert.equal(successResult.stdoutBytes, 2, "managed success must report captured output bytes");
assert.ok(successResult.durationMs >= 0, "managed success must report a non-negative duration");
assert.equal(successRuntime.spawnOptions[0].detached, true, "Linux managed commands must request detached process groups");

const nonzeroChild = makeChild(102);
const nonzeroRuntime = fakeRuntime([nonzeroChild]);
const nonzero = runner.runManagedCommand({ bin: "ffmpeg", args: [] }, {
  label: "fixture_nonzero",
  spawnImpl: nonzeroRuntime.spawnImpl,
  processImpl: nonzeroRuntime.processImpl,
});
nonzeroChild.stderr.end("failure detail");
nonzeroChild.emit("close", 2, null);
await assert.rejects(nonzero, (error) => (
  error?.code === "process_exited_nonzero"
  && error?.stderrTailBytes === "failure detail".length
  && !error?.message.includes("failure detail")
  && !Object.hasOwn(error, "stderrTail")
));

await assert.rejects(
  runner.runManagedCommand({ bin: "missing", args: [] }, {
    label: "fixture_spawn_failure",
    spawnImpl: () => { throw new Error("missing"); },
    processImpl: { platform: "linux", kill() {} },
  }),
  (error) => error?.code === "process_spawn_failed",
);

const overflowChild = makeChild(103);
const overflowRuntime = fakeRuntime([overflowChild]);
const overflow = runner.runManagedCommand({ bin: "ffmpeg", args: [] }, {
  label: "fixture_stdout_limit",
  maxStdoutBytes: 8,
  terminationGraceMs: 1,
  terminationSettleMs: 5,
  spawnImpl: overflowRuntime.spawnImpl,
  processImpl: overflowRuntime.processImpl,
});
overflowChild.stdout.write(Buffer.alloc(9));
await assert.rejects(overflow, (error) => error?.code === "process_stdout_limit_exceeded");
assert.deepEqual(
  overflowRuntime.groupSignals.map((entry) => entry.signal),
  ["SIGTERM", "SIGKILL"],
  "output overflow must escalate through a bounded TERM/KILL sequence",
);

const timeoutChild = makeChild(104);
const timeoutRuntime = fakeRuntime([timeoutChild]);
const timeout = runner.runManagedCommand({ bin: "ffmpeg", args: [] }, {
  label: "fixture_timeout",
  timeoutMs: 100,
  terminationGraceMs: 1,
  terminationSettleMs: 5,
  spawnImpl: timeoutRuntime.spawnImpl,
  processImpl: timeoutRuntime.processImpl,
});
await assert.rejects(timeout, (error) => error?.code === "process_timeout");
assert.deepEqual(timeoutRuntime.groupSignals.map((entry) => entry.signal), ["SIGTERM", "SIGKILL"]);

const forcedSettleChild = makeChild(105);
const forcedSettleRuntime = fakeRuntime([forcedSettleChild], { closeOnKill: false });
const forcedSettle = runner.runManagedCommand({ bin: "ffmpeg", args: [] }, {
  label: "fixture_forced_settle",
  timeoutMs: 100,
  terminationGraceMs: 1,
  terminationSettleMs: 1,
  spawnImpl: forcedSettleRuntime.spawnImpl,
  processImpl: forcedSettleRuntime.processImpl,
});
await assert.rejects(forcedSettle, (error) => error?.code === "process_timeout");

const producer = makeChild(106);
const consumer = makeChild(107);
const pipelineRuntime = fakeRuntime([producer, consumer]);
const pipeline = runner.runManagedPipeline([
  { bin: "python3", args: ["producer.py"] },
  { bin: "ffmpeg", args: ["-i", "pipe:0"] },
], {
  label: "fixture_pipeline",
  spawnImpl: pipelineRuntime.spawnImpl,
  processImpl: pipelineRuntime.processImpl,
});
consumer.stdout.end("pipeline-ok");
producer.stderr.end();
consumer.stderr.end();
producer.emit("close", 0, null);
consumer.emit("close", 0, null);
assert.equal((await pipeline).stdout, "pipeline-ok", "managed pipeline must retain consumer stdout contract");

const pipelineProducerFailure = makeChild(109);
const pipelineConsumerFailure = makeChild(110);
const pipelineFailureRuntime = fakeRuntime([pipelineProducerFailure, pipelineConsumerFailure]);
const pipelineFailure = runner.runManagedPipeline([
  { bin: "python3", args: ["producer.py"] },
  { bin: "ffmpeg", args: ["-i", "pipe:0"] },
], {
  label: "fixture_pipeline_nonzero",
  terminationGraceMs: 1,
  terminationSettleMs: 5,
  spawnImpl: pipelineFailureRuntime.spawnImpl,
  processImpl: pipelineFailureRuntime.processImpl,
});
pipelineProducerFailure.emit("close", 2, null);
await assert.rejects(pipelineFailure, (error) => error?.code === "process_pipeline_failed");

let pipelineSpawnAttempts = 0;
await assert.rejects(
  runner.runManagedPipeline([
    { bin: "python3", args: ["producer.py"] },
    { bin: "ffmpeg", args: ["-i", "pipe:0"] },
  ], {
    label: "fixture_pipeline_spawn_failure",
    spawnImpl: () => {
      pipelineSpawnAttempts += 1;
      throw new Error("missing pipeline binary");
    },
    processImpl: { platform: "linux", kill() {} },
  }),
  (error) => error?.code === "process_spawn_failed",
);
assert.equal(pipelineSpawnAttempts, 1, "pipeline must stop after its first synchronous spawn failure");

const signalChild = makeChild(111);
const signalRuntime = fakeRuntime([signalChild]);
const abortController = new AbortController();
const signalCancelled = runner.runManagedCommand({ bin: "ffmpeg", args: [] }, {
  label: "fixture_abort_signal",
  signal: abortController.signal,
  terminationGraceMs: 1,
  terminationSettleMs: 5,
  spawnImpl: signalRuntime.spawnImpl,
  processImpl: signalRuntime.processImpl,
});
abortController.abort();
await assert.rejects(signalCancelled, (error) => error?.code === "process_cancelled");
assert.deepEqual(signalRuntime.groupSignals.map((entry) => entry.signal), ["SIGTERM", "SIGKILL"]);

const reentrantProducer = makeChild(113);
const reentrantConsumer = makeChild(114);
const reentrantRuntime = fakeRuntime([reentrantProducer, reentrantConsumer]);
const reentrantAbortController = new AbortController();
let reentrantSpawnCount = 0;
const reentrantAbort = runner.runManagedPipeline([
  { bin: "python3", args: ["producer.py"] },
  { bin: "ffmpeg", args: ["-i", "pipe:0"] },
], {
  label: "fixture_pipeline_reentrant_abort",
  signal: reentrantAbortController.signal,
  terminationGraceMs: 1,
  terminationSettleMs: 5,
  spawnImpl: (_bin, _args, _options) => {
    const child = [reentrantProducer, reentrantConsumer][reentrantSpawnCount];
    reentrantSpawnCount += 1;
    if (reentrantSpawnCount === 2) reentrantAbortController.abort();
    return child;
  },
  processImpl: reentrantRuntime.processImpl,
});
await assert.rejects(reentrantAbort, (error) => error?.code === "process_cancelled");
assert.ok(
  reentrantRuntime.groupSignals.some((entry) => entry.pid === -reentrantConsumer.pid && entry.signal === "SIGTERM"),
  "consumer created during an abort must receive a post-spawn SIGTERM",
);

const cancelledChild = makeChild(108);
const cancelledRuntime = fakeRuntime([cancelledChild]);
const cancelled = runner.runManagedCommand({ bin: "ffmpeg", args: [] }, {
  label: "fixture_shutdown",
  timeoutMs: 60_000,
  terminationGraceMs: 1,
  terminationSettleMs: 5,
  spawnImpl: cancelledRuntime.spawnImpl,
  processImpl: cancelledRuntime.processImpl,
});
assert.equal(runner.abortAllManagedProcesses("shutdown"), 1, "shutdown registry must request every active managed process once");
await assert.rejects(cancelled, (error) => error?.code === "process_cancelled");

let postShutdownSpawned = false;
await assert.rejects(
  runner.runManagedCommand({ bin: "ffmpeg", args: [] }, {
    label: "fixture_post_shutdown_stage",
    spawnImpl: () => {
      postShutdownSpawned = true;
      return makeChild(112);
    },
    processImpl: { platform: "linux", kill() {} },
  }),
  (error) => error?.code === "process_cancelled",
);
assert.equal(postShutdownSpawned, false, "shutdown latch must reject a later stage before it spawns");

let selfTest = "skipped";
if (process.env.MUTATION_TEST === "1") {
  const assertRejected = (label, mutate) => {
    assert.throws(() => validateStructural(mutate(source)), undefined, `${label} mutation must fail the source contract`);
  };
  assertRejected("KILL escalation", (sources) => ({
    ...sources,
    runner: sources.runner.replaceAll('signalChild(child, "SIGKILL", settings);', 'signalChild(child, "SIGSTOP", settings);'),
  }));
  assertRejected("process group spawn", (sources) => ({
    ...sources,
    runner: sources.runner.replace("detached: settings.detached", "detached: false"),
  }));
  assertRejected("shared preflight runner", (sources) => ({
    ...sources,
    preflight: sources.preflight.replace('import { MAX_PROCESS_BINARY_STDOUT_BYTES, MAX_PROCESS_TEXT_STDOUT_BYTES, runManagedCommand } from "./processRunner.js";', 'import { spawn } from "node:child_process";'),
  }));
  assertRejected("shutdown cancellation", (sources) => ({
    ...sources,
    server: sources.server.replace('abortAllManagedProcesses("shutdown")', "0"),
  }));
  assertRejected("shutdown latch", (sources) => ({
    ...sources,
    runner: sources.runner.replaceAll("MANAGED_PROCESS_SHUTDOWN_REQUESTED", "MANAGED_PROCESS_DISABLED"),
  }));
  assertRejected("post-consumer cancellation", (sources) => ({
    ...sources,
    runner: sources.runner.replace("terminate(afterConsumerCancellation);", "void afterConsumerCancellation;"),
  }));

  // Production finally cleanup must stay bound to the seam on the exact local
  // workingDir. Removing one of the two cleanup sites, pointing the seam at a
  // parent (runtimeConfig.workDir), or reverting to a direct parent rm must all
  // fail the source contract. These mirror the reviewer's proven renderer
  // parent-cleanup mutation.
  assertRejected("renderer cleanup routed to parent workDir", (sources) => ({
    ...sources,
    renderer: sources.renderer.replaceAll("await removeOwnedWorkdir(workingDir).catch(() => null);",
      "await removeOwnedWorkdir(runtimeConfig.workDir).catch(() => null);"),
  }));
  assertRejected("renderer cleanup reverted to direct parent rm", (sources) => ({
    ...sources,
    renderer: sources.renderer.replace("await removeOwnedWorkdir(workingDir).catch(() => null);",
      "await rm(runtimeConfig.workDir, { recursive: true, force: true }).catch(() => null);"),
  }));
  assertRejected("renderer cleanup seam removed from ONE finally site", (sources) => ({
    ...sources,
    renderer: sources.renderer.replace(/await removeOwnedWorkdir\(workingDir\)\.catch\(\(\) => null\);\n/, ""),
  }));

  // The fidelity guard itself must be mutation-proof: removing, weakening, OR
  // commenting out EITHER of the two direct live-poll assertions (grandchild PID
  // gone / leader process group gone) must fail. These mirror the independent
  // reviewer mutations that the old substring guard wrongly accepted, including
  // a comment-sneak that a naive assert.match would accept.
  const assertTestRejected = (label, mutateTest) => {
    assert.throws(
      () => validateRunnerTestFidelity(source.runner, mutateTest(runnerTestSource)),
      undefined,
      `${label} mutation must fail the runner-test fidelity contract`,
    );
  };
  const leaderLine = '      assert.ok(await pollPidGone(leadPid, { group: true }), "leader process group must be gone after escalation");';
  const grandchildLine = '      assert.ok(await pollPidGone(gChildPid), "grandchild PID must be reaped after the group KILL");';
  assertTestRejected("grandchild PID-gone assertion removal", (testSrc) =>
    testSrc.replace(`${grandchildLine}\n`, ""));
  assertTestRejected("leader group-gone assertion removal", (testSrc) =>
    testSrc.replace(`${leaderLine}\n`, ""));
  assertTestRejected("grandchild PID-gone assertion commented out", (testSrc) =>
    testSrc.replace(grandchildLine, `    // ${grandchildLine}`));
  assertTestRejected("leader group-gone assertion commented out", (testSrc) =>
    testSrc.replace(leaderLine, `    // ${leaderLine}`));
  assertTestRejected("grandchild PID-gone assertion weakened to bare mention", (testSrc) =>
    testSrc.replace(grandchildLine, "      // pollPidGone(gchildPid)"));
  assertTestRejected("leader group-gone assertion weakened to bare mention", (testSrc) =>
    testSrc.replace(leaderLine, "      // pollPidGone(leadPid)"));

  // The rejection-race guard must be mutation-proof: removing the observer
  // helper, dropping ANY of the per-fixture observe calls (which drops the
  // guard count below 5), awaiting the observer (which would hang the abort
  // fixture), or deleting the no-op catch (which lets a rejection stay
  // rejection stay unhandled must all fail. These mirror the reviewer's proven
  // intermittent `unhandledRejection`/`process_timeout` failure.
  const assertRaceGuardRejected = (label, mutate) => {
    assert.throws(
      () => validateRunnerRejectRaceGuard(mutate(runnerTestSource)),
      undefined,
      `${label} mutation must fail the rejection-race guard`,
    );
  };
  const hungObserve = '    observeRejections(promise);';
  // Blanket removal of one fixture's observe call must drop the guarded count.
  assertRaceGuardRejected("observe call removed from ONE fixture", (testSrc) =>
    testSrc.replace(hungObserve, ""));
  assertRaceGuardRejected("observe call awaited on ONE fixture", (testSrc) =>
    testSrc.replace(hungObserve, "    await observeRejections(promise);"));
  assertRaceGuardRejected("observeRejections function body catch removed", (testSrc) =>
    testSrc.replace("promise.catch(() => {});", ""));
  assertRaceGuardRejected("observeRejections name renamed", (testSrc) =>
    testSrc.replaceAll("observeRejections", "deferredRejectionTrap"));

  // The capture-placement guard must be mutation-proof. Removing, commenting
  // out, or neutralizing the in-seam spawn forward / synchronous pid capture /
  // readyFile gate drops ONLY that specific proof; and any affected fixture can
  // lose its evidence PID bind or its readiness assertion. These mirror the
  // independent reviewer mutations (comment-sneak, decoy gate, decoy PID text)
  // that the old substring guard wrongly accepted as green evidence.
  const assertCaptureMutation = (label, mutate) => {
    assert.throws(
      () => validateCapturePlacementGuard(mutate(runnerTestSource)),
      undefined,
      `${label} mutation must fail the capture-placement guard`,
    );
  };
  // -- seam-level mutations ------------------------------------------------
  // (1) Forwarding a fake / dropping the real spawn must fail.
  assertCaptureMutation("seam no longer forwards the real nodeSpawn (fake seam)", (testSrc) =>
    testSrc.replace("nodeSpawn(bin, args, options)", "fakeSpawn(bin, args, options)"));
  // (2) The synchronous child.pid capture must be REQUIRED (removal fails).
  assertCaptureMutation("seam no longer captures child.pid synchronously", (testSrc) =>
    testSrc.replace("capture.pid = child.pid;", ""));
  // (3) The ready gate REMOVED entirely (the child returns with no wait) must
  // fail — the old broad Atomics.wait/waitForFileSync presence check misread
  // this as green because the helper still exists elsewhere.
  assertCaptureMutation("ready gate REMOVED from the seam", (testSrc) =>
    testSrc.replace('if (readyFile && !waitForFileSync(readyFile, readyTimeoutMs)) {',
      'if (false) {'));
  // (4) The ready gate NEUTRALIZED to a `false` literal (gate kept but disabled)
  // must fail.
  assertCaptureMutation("ready gate NEUTRALIZED to false", (testSrc) =>
    testSrc.replace('if (readyFile && !waitForFileSync(readyFile, readyTimeoutMs)) {',
      'if (readyFile && false) {'));
  // (5) The ready gate REDIRECTED to a decoy path (waits on a different arg than
  // the real readyFile) must fail.
  assertCaptureMutation("ready gate REDIRECTED to a decoy path", (testSrc) =>
    testSrc.replace('if (readyFile && !waitForFileSync(readyFile, readyTimeoutMs)) {',
      'if (readyFile && !waitForFileSync(decoyFile, readyTimeoutMs)) {'));
  // (6) The live pid capture commented out while the decoy text stays (a
  // comment-sneak against the synchronous bind) must fail.
  assertCaptureMutation("seam pid capture commented out (comment-sneak)", (testSrc) =>
    testSrc.replace('    capture.pid = child.pid;', '    // capture.pid = child.pid;'));
  // -- per-fixture PID bind / readiness assertion variants ----------------
  assertCaptureMutation("hung fixture PID bind commented out", (testSrc) =>
    testSrc.replace('    pid = hung.pid;', '    // pid = hung.pid;'));
  assertCaptureMutation("secret fixture PID bind commented out", (testSrc) =>
    testSrc.replace('    pid = sec.pid;', '    // pid = sec.pid;'));
  assertCaptureMutation("abort fixture PID bind commented out", (testSrc) =>
    testSrc.replace('    pid = ab.pid;', '    // pid = ab.pid;'));
  assertCaptureMutation("group fixture PID bind commented out", (testSrc) =>
    testSrc.replace('    leadPid = group.pid;', '    // leadPid = group.pid;'));
  assertCaptureMutation("overflow fixture PID bind commented out", (testSrc) =>
    testSrc.replace('    pid = overflow.pid;', '    // pid = overflow.pid;'));
  assertCaptureMutation("hung readiness assertion commented out", (testSrc) =>
    testSrc.replace('    assert.ok(hung.ready, "hung child must publish its ready marker before the 400ms timer starts");',
      '    // assert.ok(hung.ready, "hung child must publish its ready marker (decoy)");'));
  assertCaptureMutation("secret readiness assertion commented out", (testSrc) =>
    testSrc.replace('    assert.ok(sec.ready, "secret child must issue its stderr write before the 300ms timer starts");',
      '    // assert.ok(sec.ready, "secret child must issue its stderr write (decoy)");'));
  assertCaptureMutation("abort readiness assertion commented out", (testSrc) =>
    testSrc.replace('    assert.ok(ab.ready, "abort child must be LIVE before the external signal is issued");',
      '    // assert.ok(ab.ready, "abort child must be LIVE (decoy)");'));
  assertCaptureMutation("group readiness assertion commented out", (testSrc) =>
    testSrc.replace('      assert.ok(group.ready, "group leader+descendant must be SIGTERM-ready before the 700ms timer starts");',
      '      // assert.ok(group.ready, "group leader+descendant must be SIGTERM-ready (decoy)");'));
  // (7) Removed bindings / removed assertions must fail (the originals).
  assertCaptureMutation("hung fixture loses its in-seam readiness bind", (testSrc) =>
    testSrc.replace('    pid = hung.pid;', ""));
  assertCaptureMutation("secret fixture loses its in-seam readiness bind", (testSrc) =>
    testSrc.replace('    pid = sec.pid;', ""));
  assertCaptureMutation("abort fixture loses its in-seam readiness bind", (testSrc) =>
    testSrc.replace('    pid = ab.pid;', ""));
  assertCaptureMutation("group fixture loses its in-seam readiness bind", (testSrc) =>
    testSrc.replace('    leadPid = group.pid;', ""));
  assertCaptureMutation("overflow fixture loses its in-seam capture bind", (testSrc) =>
    testSrc.replace('    pid = overflow.pid;', ""));
  assertCaptureMutation("hung readiness assertion removed", (testSrc) =>
    testSrc.replace('assert.ok(hung.ready, "hung child must publish its ready marker before the 400ms timer starts");', ""));
  assertCaptureMutation("secret readiness assertion removed", (testSrc) =>
    testSrc.replace('assert.ok(sec.ready, "secret child must issue its stderr write before the 300ms timer starts");', ""));
  assertCaptureMutation("abort readiness assertion removed", (testSrc) =>
    testSrc.replace('assert.ok(ab.ready, "abort child must be LIVE before the external signal is issued");', ""));
  assertCaptureMutation("group readiness assertion removed", (testSrc) =>
    testSrc.replace('      assert.ok(group.ready, "group leader+descendant must be SIGTERM-ready before the 700ms timer starts");', ""));

// -- masker-decoy self-mutations (fail-closed on needle absence) -------------
  // Each mutation reproduces a reviewer's proven bypass that the OLD
  // line-start-only `liveLineOf` wrongly accepted: the real statement is removed
  // (or moved) while an IDENTICAL decoy survives inside a multiline block comment
  // or template literal — whose interior lines previously presented as
  // statement-initial. A mutation is REAL only if its needle is present exactly
  // once in the unmodified source; a missing/double needle would make the edit a
  // silent no-op, so we assert that up front and rely on `assert.throws` to
  // reject the absent-detector case (a mutation that stops changing its target
  // must fail loudly rather than no-op).
  const assertCaptureMutable = (label, mutate) => {
    assert.throws(
      () => validateCapturePlacementGuard(mutate(runnerTestSource)),
      undefined,
      `${label} mutation must fail the capture-placement guard`,
    );
  };

  // (1) The live in-seam `capture.pid = child.pid;` removed while an identical
  //     decoy survives inside a multiline block comment. The masking proof must
  //     see the live statement ABSENT (block-comment text is blanked) and reject.
  assertCaptureMutable(
    "in-seam pid capture removed, block-comment decoy retained",
    (testSrc) => {
      const needle = "capture.pid = child.pid;";
      const idx = testSrc.indexOf(needle);
      assert.ok(idx >= 0 && testSrc.indexOf(needle, idx + 1) < 0, "needle (in-seam pid capture) must appear exactly once");
      return `${testSrc.slice(0, idx)}/* removed\n   ${needle}\n*/\n${testSrc.slice(idx + needle.length)}`;
    },
  );
  // (2) The same in-seam capture removed and reproduced inside a MULTILINE
  //     template literal.
  assertCaptureMutable(
    "in-seam pid capture removed, template-literal decoy retained",
    (testSrc) => {
      const needle = "capture.pid = child.pid;";
      const idx = testSrc.indexOf(needle);
      assert.ok(idx >= 0 && testSrc.indexOf(needle, idx + 1) < 0, "needle (in-seam pid capture) must appear exactly once");
      return `${testSrc.slice(0, idx)}const decoy = \`\n  ${needle}\n\`;\n${testSrc.slice(idx + needle.length)}`;
    },
  );
  // (3) The readyFile gate removed from the live seam while a decoy survives
  //     inside a template literal.
  assertCaptureMutable(
    "ready gate removed, template-literal decoy retained",
    (testSrc) => {
      const needle = "if (readyFile && !waitForFileSync(readyFile, readyTimeoutMs)) {";
      const idx = testSrc.indexOf(needle);
      assert.ok(idx >= 0 && testSrc.indexOf(needle, idx + 1) < 0, "needle (ready gate) must appear exactly once");
      return `${testSrc.slice(0, idx)}const decoy = \`\n  ${needle}\n\`;\n${testSrc.slice(idx + needle.length)}`;
    },
  );
  // (4) The hung fixture's LIVE bind `pid = hung.pid;` removed and reproduced
  //     inside a template literal (its semantic region also must NOT match).
  assertCaptureMutable(
    "hung fixture pid bind moved into a template-literal decoy",
    (testSrc) => {
      const needle = "pid = hung.pid;";
      const idx = testSrc.indexOf(needle);
      assert.ok(idx >= 0 && testSrc.indexOf(needle, idx + 1) < 0, "needle (hung pid bind) must appear exactly once");
      return `${testSrc.slice(0, idx)}const dead = \`decoy\n  ${needle}\n\`;\n${testSrc.slice(idx + needle.length)}`;
    },
  );
  // (5) The preceding-decoy bypass: an EARLIER multiline block comment and
  //    template literal both reproduce a byte-identical `const hung = liveSpawn(`
  //    declaration and pid bind BEFORE the real fixture. If the region were
  //    located via `testSrc.indexOf(declLine)` (a raw unmasked substring
  //    lookup), the earlier decoy would win that search and the region would
  //    exclude the real fixture body, hiding a real-proof removal. The masked
  //    live-match offset must land on the REAL declaration, so removing the
  //    real pid bind is still detected: reject.
  assertCaptureMutable(
    "earlier template + block-comment decoy, real hang pid bind removed",
    (testSrc) => {
      const decl = "    const hung = liveSpawn({ readyFile: hungReady, label: \"hung\" });";
      const pid = "    pid = hung.pid;";
      const hungTestMark = "test(\"hung real child is TERM+settled and provably dead after timeout\",";
      // Exact-one fail-closed guards: the real decl, pid bind, and hung-test
      // anchor must each occur exactly once in the unmodified source, so the
      // mutation is a REAL edit, not a silent no-op.
      const declCount = testSrc.split(decl).length - 1;
      const pidCount = testSrc.split(pid).length - 1;
      const testCount = testSrc.split(hungTestMark).length - 1;
      assert.ok(declCount === 1, `anchor (hung liveSpawn decl) must appear exactly once; got ${declCount}`);
      assert.ok(pidCount === 1, `anchor (hung pid bind) must appear exactly once; got ${pidCount}`);
      assert.ok(testCount === 1, `anchor (hung test) must appear exactly once; got ${testCount}`);
      const testAt = testSrc.indexOf(hungTestMark);
      const pidAt = testSrc.indexOf(pid);
      assert.ok(testAt < pidAt, "hung test must precede its real pid bind");
      // Insert an EARLIER multiline decoy — a byte-identical declaration and
      // pid bind inside a template literal AND a block comment — immediately
      // BEFORE the hung test. A raw `testSrc.indexOf(declLine)` would then
      // mis-anchor on the decoy's offset, its region runs only to the next
      // `test(...)` boundary (the hung test's OWN start, which precedes the
      // real decl), excluding the real fixture body — hiding the removed pid
      // bind. The masked live-match offset must instead land on the REAL decl
      // inside the hung test, so the real region still wraps the body and the
      // removal is detected: reject.
      const decoy = `const decoy = \\\`\n  ${decl}\n  ${pid}\n\\\`;\n` +
        `/* earlier\n   ${decl}\n   ${pid}\n*/\n`;
      const removed = testSrc.slice(0, pidAt) + testSrc.slice(pidAt + pid.length);
      return removed.slice(0, testAt) + decoy + removed.slice(testAt);
    },
  );
  // (6) The EXACT ordering bypass: the real `capture.pid = child.pid;` is MOVED
  //    to AFTER `return child;` inside the seam, while an identical interior
  //    template-literal decoy stays at the ORIGINAL location. A bare-substring
  //    ordering check (pid-before-return) sees the decoy and passes; the
  //    live/masked ordering proof must see the pid capture ABSENT from its live
  //    slot and reject it.
  assertCaptureMutable(
    "pid capture moved after return child (interior template decoy at origin)",
    (testSrc) => {
      const captureN = "capture.pid = child.pid;";
      const retN = "return child;";
      const captIdx = testSrc.indexOf(captureN);
      const retIdx = testSrc.indexOf(retN);
      // `captureN` must occur exactly once; `retN`'s FIRST occurrence is the
      // in-seam return (a second `return child;` exists in a helper helper, so we
      // only require the first, which is strictly after the capture).
      assert.ok(
        captIdx >= 0 && retIdx > captIdx && testSrc.indexOf(captureN, captIdx + 1) < 0,
        "needles (single in-seam capture before the first in-seam return) must hold",
      );
      // Move the real capture to AFTER the return, leaving an identical decoy
      // inside a template literal exactly where the capture was.
      const decoy = `const decoy = \`\n  ${captureN}\n\`;\n`;
      const withDecoy = `${testSrc.slice(0, captIdx)}${decoy}${testSrc.slice(captIdx + captureN.length)}`;
      // fresh return index in withDecoy (the decoy shifted nothing before retIdx)
      const ret2 = withDecoy.indexOf(retN);
      assert.ok(ret2 > captIdx, "in-seam return must still follow the capture slot");
      return `${withDecoy.slice(0, ret2 + retN.length)}\n${captureN}${withDecoy.slice(ret2 + retN.length)}`;
    },
  );
  // -- direct masker regressions (the scanner must never enter a false state) --
  // The scanner blanks strings, comments, regex and template raw text using a
  // self-terminating token model: a delimiter that appears inside a STRING or a
  // REGEX body is literal, so it must be consumed rather than treated as a new
  // comment / template opener. These call maskNonExecutable directly so a
  // regression (a naive "any `//` or backtick is a delimiter" lexer) fails
  // loudly even if no fixture line happens to trip it. Each crafted source is
  // valid JS that a broken lexer would mis-state on; the assertions to prove the
  // correct, non-false output.
  (() => {
    const mask = maskNonExecutable;
    const assertMask = (label, source, realTail) => {
      const out = mask(source);
      assert.equal(typeof out, "string", `${label}: masker must return a string`);
      assert.equal(out.length, source.length, `${label}: masker must preserve exact length`);
      assert.ok(
        out.includes(realTail),
        `${label}: code AFTER the literal must survive; got tail missing: ${JSON.stringify(out.slice(-40))}`,
      );
    };
    const assertBlanked = (label, source, decoyText) => {
      assert.ok(
        !mask(source).includes(decoyText),
        `${label}: decoy byte-run inside the literal must be fully masked`,
      );
    };

    // (a) A double-quoted string containing a backtick and `//`: the whole string
    //     is a single string token; the backtick must NOT open a template and the
    //     `//` must NOT start a line comment, so the live statement after it
    //     survives intact.
    const a = 'let a = "back ` // tic"; let liveTail = 1;';
    assertBlanked("backtick + line-comment INSIDE double string", a, "tick");
    assertBlanked("backtick + line-comment INSIDE double string", a, "// t");
    assertMask("backtick + line-comment INSIDE double string", a, "let liveTail = 1;");

    // (b) Single-quoted string holding a backtick and a block-comment opener.
    const b = "let q = 'b ` /* seamlit'; let liveTail2 = 2;";
    assertBlanked("backtick + block-comment text INSIDE single string", b, "seaml");
    assertMask("backtick + block-comment text INSIDE single string", b, "let liveTail2 = 2;");

    // (c) A regex literal whose body/character-class contains a backtick and a
    //     `/*`-style sequence: both are regex body characters, so the scanner
    //     must consume the whole regex (not misstate a template/comment) and the
    //     trailing statement must survive.
    const c = "const re = /[`\\/*\\/]/g; let liveTail3 = 3;";
    assertBlanked("backtick + slash-inside regex", c, "/*");
    assertMask("backtick + slash-inside regex", c, "let liveTail3 = 3;");

    // (d) A template literal containing an interpolation whose expression holds a
    //     nested double-quoted string with its own backtick + comment text. The
    //     nested string is consumed as one token (its backtick is literal), the
    //     expression closes correctly, and the outer template terminates properly,
    //     so the trailing statement survives unscanned.
    const d = "const t = `a ${\"x ` // stilllit\"} b`; let liveTail4 = 4;";
    assertBlanked("nested string with backtick inside template interp", d, "stilllit");
    assertMask("nested string with backtick inside template interp", d, "let liveTail4 = 4;");

    // (e) A REGEX that spans a newline must have its ENTIRE interior masked (a
    //     mutation could hide a statement inside such a body; the blanker must
    //     keep scanning across the "\n" until the closing `/`, with the newline
    //     itself preserved for exact length). Both the regex-only interior and a
    //     verbatim decoy statement line inside it must disappear.
    const e = "const re = /ab\n  decoy = child.pid;\n/gi; let liveTail5 = 5;";
    assertBlanked("multiline regex interior decoy", e, "decoy");
    assertMask("multiline regex interior decoy", e, "let liveTail5 = 5;");

    // (f) A regex that begins after a value-delimiter (`;` or block-closing `}`)
    //     on a fresh line must be treated as a REGEX literal (not division), so
    //     its interior decoy text is blanked. A broken/division-only lexer leaves
    //     it visible.
    const f1 = "go();\n/decoy1/i\nkeep6();";
    assertBlanked("regex after semicolon-line is masked", f1, "decoy1");
    assertMask("regex after semicolon-line is masked", f1, "keep6();");
    const f2 = "if (ok) {}\n/decoy2/g\nkeep7();";
    assertBlanked("regex after closing brace is masked", f2, "decoy2");
    assertMask("regex after closing brace is masked", f2, "keep7();");

    // (g) EXACT Luna probe (regression): a `/` that opens a REGEX after the
    //     `return` keyword must be masked as a regex literal — NOT classified as
    //     division. The old char-by-char classifier scored `return`'s leading `r`
    //     as an operand, so the `/` was read as division and the regex's opening
    //     backtick started a false template that blanked the entire live tail.
    //     Here `return` is followed by a regex whose body carries a backtick and
    //     escaped slashes; the whole body must be hidden while the newline that
    //     follows survives and the `let afterReturnRegex = 1;` tail stays visible
    //     at the same offset.
    const g = "function f(){ return /`\\/\\/[x]/; }\nlet afterReturnRegex = 1;";
    assert.equal(mask(g).length, g.length, "Luna probe: masker must preserve exact length");
    assert.ok(!mask(g).includes("[x]"), "Luna probe: regex body must be masked");
    assert.ok(!mask(g).includes("`"), "Luna probe: backtick inside the regex body must be masked");
    assert.ok(
      mask(g).includes("let afterReturnRegex = 1;"),
      `Luna probe: live tail after the regex must survive; got: ${JSON.stringify(mask(g).slice(-40))}`,
    );

    // (h)/(i)/(j) EXACT throw/await/instanceof probes (regression): the same
    // false-template failure the `return` probe above catches applies to
    // `throw /regex/`, `await /regex/`, and `x instanceof /regex/`. A `/` that
    // opens a regex after any of these keyword/operator tokens must be masked
    // as a whole literal — NOT classified as division, which would let the
    // regex's opening backtick start a false template state that blanks the
    // entire live tail. Each probe classifies its keyword/operator (leaving the
    // next token in operand-start position) and preserves division for property
    // names/ordinary operands via the `.`-before guard. Same-length and
    // newline-preserving, with the live tail surviving at its original offset.
    const h = "function f(){ throw /`\\/\\/[x]/; }\nlet afterThrowRegex = 1;";
    assert.equal(mask(h).length, h.length, "throw probe: masker must preserve exact length");
    assert.ok(!mask(h).includes("[x]"), "throw probe: regex body must be masked");
    assert.ok(!mask(h).includes("`"), "throw probe: backtick inside the regex body must be masked");
    assert.ok(
      mask(h).includes("let afterThrowRegex = 1;"),
      `throw probe: live tail after the regex must survive; got: ${JSON.stringify(mask(h).slice(-40))}`,
    );
    const i = "(async function(){ await /`\\/\\/[x]/; })();\nlet afterAwaitRegex = 1;";
    assert.equal(mask(i).length, i.length, "await probe: masker must preserve exact length");
    assert.ok(!mask(i).includes("[x]"), "await probe: regex body must be masked");
    assert.ok(!mask(i).includes("`"), "await probe: backtick inside the regex body must be masked");
    assert.ok(
      mask(i).includes("let afterAwaitRegex = 1;"),
      `await probe: live tail after the regex must survive; got: ${JSON.stringify(mask(i).slice(-40))}`,
    );

    const j = "if (err instanceof /`\\/\\/[x]/) {}\nlet afterInstanceofRegex = 1;";
    assert.equal(mask(j).length, j.length, "instanceof probe: masker must preserve exact length");
    assert.ok(!mask(j).includes("[x]"), "instanceof probe: regex body must be masked");
    assert.ok(!mask(j).includes("`"), "instanceof probe: backtick inside the regex body must be masked");
    assert.ok(
      mask(j).includes("let afterInstanceofRegex = 1;"),
      `instanceof probe: live tail after the regex must survive; got: ${JSON.stringify(mask(j).slice(-40))}`,
    );
  })();
  const assertCleanupRejected = (label, mutate) => {
    assert.throws(
      () => validateCleanupTestFidelity(mutate(cleanupTestSource)),
      undefined,
      `${label} mutation must fail the cleanup-test fidelity contract`,
    );
  };
  assertCleanupRejected("production seam replaced with direct rm", (testSrc) =>
    testSrc
      .replace('import { removeOwnedWorkdir } from "../src/renderer.js";', 'import { rm } from "node:fs/promises";')
      .replace("await removeOwnedWorkdir(workingDir);", "await rm(workingDir, { recursive: true, force: true });"));
  assertCleanupRejected("production seam replaced with reformatted direct rm", (testSrc) =>
    testSrc
      .replace('import { removeOwnedWorkdir } from "../src/renderer.js";', 'import { rm } from "node:fs/promises";')
      .replace("await removeOwnedWorkdir(workingDir);", "await rm(workingDir,{force:true,recursive:true});"));
  assertCleanupRejected("decoy seam call over never-owned path", (testSrc) =>
    testSrc.replace("await removeOwnedWorkdir(workingDir);",
      "await removeOwnedWorkdir(join(store, \"no-such\"));\n    await rm(workingDir, { recursive: true, force: true });"));
  assertCleanupRejected("seam pointed at parent store", (testSrc) =>
    testSrc.replace("await removeOwnedWorkdir(workingDir);", "await removeOwnedWorkdir(store);"));
  assertCleanupRejected("seam pointed at parent root", (testSrc) =>
    testSrc.replace("await removeOwnedWorkdir(dropped);", "await removeOwnedWorkdir(root);"));
  selfTest = "pass";
}

console.log(`RENDERER_PROCESS_RUNNER_SOURCE_CONTRACT_PASS renderTimeout=${runner.PROCESS_STAGE_TIMEOUT_MS.render} binaryBytes=${runner.MAX_PROCESS_BINARY_STDOUT_BYTES} selfTest=${selfTest}`);
