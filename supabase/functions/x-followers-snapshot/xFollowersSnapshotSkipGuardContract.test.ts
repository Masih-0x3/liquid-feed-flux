import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

// This is a source-text contract test for the orphan-snapshot retry-suppression fix.
//
// The `x-followers-snapshot` Edge Function inserts a snapshot row up-front as
// `status='partial'` with zero counts and no `error`. Before this fix, a throw
// between that insert and the final complete/partial update left an "orphan"
// `partial` row that the unfiltered skip guards treated as a fresh successful
// snapshot, suppressing retries. The fix has two coordinated parts:
//
//   1. Both skip-guard queries (manual freshness + cron daily-cap) add a `.or(...)`
//      filter so a row counts as "fresh" only if it is `complete` OR a `partial`
//      that carries real captured data (follower_count > 0) or a deliberate halt
//      error code (error IS NOT NULL). The orphan (status=partial, zero data,
//      error NULL) and a failed run (status='failed') are excluded.
//
//   2. The outer catch, when an insert succeeded, best-effort updates the row to
//      `status='failed'` with the bounded error code and the in-memory progress
//      counters, so the orphan signature can never persist after a failed run.
//
// Because the handler keeps all logic inside the `serve(...)` closure (it
// creates its Supabase client internally and is not unit-testable end-to-end
// without a live PostgREST), this test asserts the fix structurally on the
// source AND behaviorally evaluates the exact PostgREST filter string against
// every relevant row shape.

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

const EXPECTED_FRESH_FILTER =
  "status.eq.complete,and(status.eq.partial,follower_count.gt.0),and(status.eq.partial,error.not.is.null)";

// ─── Part 1: both skip-guard queries carry the fresh filter ───────────────

Deno.test("x-followers-snapshot: manual freshness and cron daily-cap guards both apply the fresh-row .or() filter", () => {
  const orLiterals = [...source.matchAll(/\.or\('([^']*)'\)/g)].map((m) => m[1]);
  assertEquals(orLiterals.length, 2, "exactly two skip-guard queries must apply the fresh filter (one manual, one cron)");
  assertEquals(orLiterals[0], EXPECTED_FRESH_FILTER, "manual freshness guard filter drifted");
  assertEquals(orLiterals[1], EXPECTED_FRESH_FILTER, "cron daily-cap guard filter drifted");

  assertStringIncludes(
    source,
    "const { data: latestSnap, error: latestSnapshotError } = await supabase\n      .from('x_follower_snapshots')\n      .select('id, taken_at, status, follower_count, following_count, api_calls_used')\n      .or('status.eq.complete,and(status.eq.partial,follower_count.gt.0),and(status.eq.partial,error.not.is.null)')\n      .order('taken_at', { ascending: false })\n      .limit(1)\n      .maybeSingle();",
    "manual freshness guard must order the filter before order/limit",
  );
  assertStringIncludes(
    source,
    "const { data: recent, error: recentSnapshotError } = await supabase\n        .from('x_follower_snapshots')\n        .select('id, taken_at, status')\n        .gte('taken_at', new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString())\n        .or('status.eq.complete,and(status.eq.partial,follower_count.gt.0),and(status.eq.partial,error.not.is.null)')\n        .order('taken_at', { ascending: false })\n        .limit(1);",
    "cron daily-cap guard must order the filter after the taken_at gte and before order/limit",
  );
});

// ─── Part 2: the fresh filter has correct semantics for every row shape ───

type Row = Record<string, unknown>;

function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    if (depth === 0 && ch === sep) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

function evalClause(clause: string, row: Row): boolean {
  const trimmed = clause.trim();
  if (trimmed.startsWith("and(") && trimmed.endsWith(")")) {
    return splitTopLevel(trimmed.slice(4, -1), ",").every((c) => evalClause(c, row));
  }
  if (trimmed.startsWith("or(") && trimmed.endsWith(")")) {
    return splitTopLevel(trimmed.slice(3, -1), ",").some((c) => evalClause(c, row));
  }
  const parts = trimmed.split(".");
  const col = parts[0];
  const rest = parts.slice(1);
  let negate = false;
  let op: string;
  let val: string;
  if (rest[0] === "not") {
    negate = true;
    op = rest[1];
    val = rest.slice(2).join(".");
  } else {
    op = rest[0];
    val = rest.slice(1).join(".");
  }
  const cell = row[col];
  let result: boolean;
  switch (op) {
    case "eq":
      result = String(cell) === val;
      break;
    case "gt":
      result = Number(cell) > Number(val);
      break;
    case "is":
      result = val === "null" ? (cell === null || cell === undefined) : String(cell) === val;
      break;
    default:
      result = false;
  }
  return negate ? !result : result;
}

function evalFilter(filter: string, row: Row): boolean {
  // The .or(...) content is a top-level OR of comma-separated clauses, with
  // commas inside and(...) groups respected by splitTopLevel.
  return splitTopLevel(filter, ",").some((c) => evalClause(c.trim(), row));
}

Deno.test("x-followers-snapshot: fresh filter includes completed and designed-halted rows, excludes orphan and failed rows", () => {
  const cases: Array<{ name: string; row: Row; fresh: boolean }> = [
    {
      name: "orphan (insert-then-throw): partial, zero data, no error",
      row: { status: "partial", follower_count: 0, error: null },
      fresh: false,
    },
    {
      name: "completed snapshot",
      row: { status: "complete", follower_count: 5, error: null },
      fresh: true,
    },
    {
      name: "designed halted-partial with real data (rate limit mid-run)",
      row: { status: "partial", follower_count: 1200, error: "rate_limited" },
      fresh: true,
    },
    {
      name: "designed empty-halt (429 on the very first page; no data, error set)",
      row: { status: "partial", follower_count: 0, error: "rate_limited" },
      fresh: true,
    },
    {
      name: "failed run marked by the catch (no data, error set)",
      row: { status: "failed", follower_count: 0, error: "followers_cache_upsert_failed" },
      fresh: false,
    },
    {
      name: "failed run that captured data before throwing (status='failed' dominates)",
      row: { status: "failed", follower_count: 50, error: "followers_cache_upsert_failed" },
      fresh: false,
    },
  ];
  for (const c of cases) {
    assertEquals(evalFilter(EXPECTED_FRESH_FILTER, c.row), c.fresh, `fresh-filter misclassified: ${c.name}`);
  }
});

// ─── Part 3: the catch cleans up the orphan row best-effort ──────────────

Deno.test("x-followers-snapshot: outer catch marks the inserted row as status='failed' with the bounded error and progress counters", () => {
  const catchStart = source.indexOf("} catch (e) {");
  assert(catchStart >= 0, "outer catch must exist");
  const catchBlock = source.slice(catchStart);

  // State hoisted to the serve-callback scope so the catch can read it.
  assertStringIncludes(source, "let snapshotId: string | null = null;");
  assertStringIncludes(source, "let pages = 0;");
  assertStringIncludes(source, "let apiCalls = 0;");
  assertStringIncludes(source, "let followingPages = 0;");
  // The inserted snapshot id is captured by assignment (not a block-scoped const).
  assertStringIncludes(source, "snapshotId = snapRow.id as string;");

  // The catch must still normalize and report the bounded error (regression guard).
  assertStringIncludes(catchBlock, "const errorCode = safeFollowerErrorCode(e);");
  assertStringIncludes(catchBlock, "captureEdgeException(safeError,");

  // The cleanup must be gated on snapshotId (skip when the insert itself failed).
  assertStringIncludes(catchBlock, "if (snapshotId) {");
  // The cleanup must update the orphan row to status='failed' with the bounded
  // error code and the in-memory progress counters.
  assertStringIncludes(catchBlock, "status: 'failed',");
  assertStringIncludes(catchBlock, "error: errorCode,");
  assertStringIncludes(catchBlock, "pages_fetched: pages + followingPages,");
  assertStringIncludes(catchBlock, "api_calls_used: apiCalls,");
  assertStringIncludes(catchBlock, ").eq('id', snapshotId);");
  // The cleanup must be best-effort and never mask the original error.
  assertStringIncludes(catchBlock, "} catch {");
  assertStringIncludes(catchBlock, "best-effort orphan cleanup");

  // The 500 error-response shape is unchanged.
  assertStringIncludes(catchBlock, 'return new Response(JSON.stringify({ error: errorCode }), {');
  assertStringIncludes(catchBlock, "status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },");
});

Deno.test("x-followers-snapshot: up-front insert still uses the designed partial shape (failed status is a catch-only transition)", () => {
  assertStringIncludes(
    source,
    ".insert({ trigger, status: 'partial', follower_count: 0, follower_ids: [], following_ids: [], following_count: 0, pages_fetched: 0, api_calls_used: 0 })",
    "the up-front snapshot insert shape is unchanged",
  );
  assertStringIncludes(
    source,
    "error: safeFollowerErrorCode(halted.reason, 'follower_snapshot_partial'),",
    "the designed halted-partial path still writes a bounded error code into a status='partial' row",
  );
  // 'failed' must appear exactly once (only in the catch cleanup).
  const failedCount = (source.match(/status: 'failed'/g) ?? []).length;
  assertEquals(failedCount, 1, "status: 'failed' must be a single catch-only write");
});
