import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const repair = "20260907001640_video_render_feedback_qualified_columns.sql";

function checkFixture(mutate = () => {}) {
  const fixture = mkdtempSync(join(tmpdir(), "xot-cutover-contract-"));
  try {
    mkdirSync(join(fixture, "scripts"));
    cpSync(new URL("scripts/check-v1-delivery-cutover.mjs", root), join(fixture, "scripts/check-v1-delivery-cutover.mjs"));
    cpSync(new URL("supabase/migrations", root), join(fixture, "supabase/migrations"), { recursive: true });
    cpSync(new URL("supabase/functions", root), join(fixture, "supabase/functions"), { recursive: true });
    mutate(join(fixture, "supabase/migrations"));
    return spawnSync(process.execPath, [join(fixture, "scripts/check-v1-delivery-cutover.mjs")], { encoding: "utf8" });
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

test("cutover contract accepts the exact qualification-only feedback successor", () => {
  const result = checkFixture();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /v1 delivery cutover SQL contract PASS/);
});

for (const [name, mutate] of [
  ["missing repair", (dir) => rmSync(join(dir, repair))],
  ["extra later migration", (dir) => writeFileSync(join(dir, "20260908000000_unreviewed.sql"), "SELECT 1;")],
  ["missing zero-write fence", (dir) => rmSync(join(dir, "20260830120000_enforce_historical_delivery_zero_write.sql"))],
  ["changed repair body", (dir) => writeFileSync(join(dir, repair), readFileSync(join(dir, repair), "utf8") + "\nSELECT 1;\n")],
  ["cutover override in repair", (dir) => writeFileSync(join(dir, repair), readFileSync(join(dir, repair), "utf8") + "\nDROP TRIGGER trg_00_historical_delivery_job_zero_write ON public.jobs;\n")],
]) {
  test(`cutover contract rejects ${name}`, () => {
    const result = checkFixture(mutate);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Error|ENOENT/);
  });
}
