// Local-only replay of the current migration chain and remaining-PR regressions.
// Requires the pinned image already cached; never pulls, publishes ports, or mounts host data.
import { randomBytes } from 'node:crypto';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E7_DISPOSABLE_PRELUDE, E7_EXPECTED_IMAGE, E7_INIT_COMPLETE_MARKER } from './e7DisposableBoundary.mjs';
import { runBoundedProcess, safeChildEnv } from './e10SqlBoundary.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const context = process.env.XOT_REPLAY_DOCKER_CONTEXT || 'default';
const name = `xot-remaining-pr-${Date.now()}-${randomBytes(4).toString('hex')}`;
const label = 'xot.remaining-pr-replay';
const temp = await mkdtemp(join(tmpdir(), 'xot-pr-sql-'));
const cidfile = join(temp, 'cid');
const children = new Set();
let id;
let interrupted = false;
const env = safeChildEnv(process.env, { POSTGRES_PASSWORD: randomBytes(48).toString('base64url') });
async function docker(args, input, timeout = 30000) {
  const result = await runBoundedProcess({ file: 'docker', args: ['--context', context, ...args], cwd: root,
    env, input, timeout, maxBuffer: 16 * 1024 * 1024, maxInput: 32 * 1024 * 1024,
    activeChildren: children, killImpl: (pid, signal) => { try { process.kill(-pid, signal); } catch {} } });
  if (result.status !== 0 || result.signal) throw new Error(`docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
async function sql(input) {
  if (interrupted) throw new Error('replay interrupted');
  return docker(['exec', '-i', id, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', '-U', 'supabase_admin', '-d', 'postgres'], input, 180000);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  interrupted = true;
  for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
});
try {
  const config = JSON.parse(await docker(['context', 'inspect', context]));
  if (!config[0]?.Endpoints?.docker?.Host?.startsWith('unix://')) throw new Error('local Unix Docker endpoint required');
  await docker(['image', 'inspect', E7_EXPECTED_IMAGE]);
  await docker(['create', '--pull=never', '--name', name, '--cidfile', cidfile,
    '--label', `${label}=${name}`, '--network', 'none', '--cpus', '1', '--memory', '768m',
    '--env', 'POSTGRES_PASSWORD', E7_EXPECTED_IMAGE, 'postgres', '-D', '/etc/postgresql']);
  id = (await readFile(cidfile, 'utf8')).trim();
  const [container] = JSON.parse(await docker(['inspect', id]));
  if (container.Config.Labels[label] !== name || container.HostConfig.NetworkMode !== 'none'
    || Object.keys(container.HostConfig.PortBindings || {}).length || container.Mounts.some(m => m.Type === 'bind')) {
    throw new Error('isolated container ownership check failed');
  }
  await docker(['start', id]);
  const deadline = Date.now() + 180000;
  while (true) {
    if (interrupted || Date.now() > deadline) throw new Error('database readiness timed out/interrupted');
    const logs = await docker(['logs', id]);
    if (logs.includes(E7_INIT_COMPLETE_MARKER)) {
      try { await docker(['exec', id, 'pg_isready', '-U', 'supabase_admin']); break; } catch {}
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await sql(E7_DISPOSABLE_PRELUDE);
  const migrationDir = join(root, 'supabase/migrations');
  const names = (await readdir(migrationDir)).filter(n => /^\d{14}_.+\.sql$/.test(n)).sort();
  for (const filename of names) {
    try { await sql(await readFile(join(migrationDir, filename), 'utf8')); }
    catch (error) { throw new Error(`${filename}: ${error.message}`); }
  }
  console.log(`Replayed ${names.length} migrations on isolated PostgreSQL.`);
  console.log(await sql(await readFile(join(root, 'scripts/remaining-pr-regressions.sql'), 'utf8')));
  // Independent connections race for admission. Exactly one may own the lease.
  await sql('DELETE FROM public.x_follower_snapshots;');
  const snapshots = await Promise.all([sql("SELECT public.claim_follower_snapshot('manual', true, 60);"), sql("SELECT public.claim_follower_snapshot('manual', true, 60);")]);
  if (snapshots.map(JSON.parse).filter(r => r.claimed).length !== 1) throw new Error('concurrent follower admission failed');
  console.log('PASS concurrent follower admission');
  await sql(`UPDATE public.settings SET value='{"media_uploads_per_day":5}' WHERE key='x_rate_limits';
    INSERT INTO public.x_deliveries(id,post_id,status,claim_state,claim_token,claim_generation,claim_expires_at)
    VALUES ('00000000-0000-0000-0000-000000008030','replay-ordinary','posting','preparing','00000000-0000-0000-0000-000000008031',1,now()+interval '1 hour'),
    ('00000000-0000-0000-0000-000000008040','replay-future','posting','preparing','00000000-0000-0000-0000-000000008041',1,now()+interval '1 hour');`);
  const reservations = await Promise.all([
    sql("SELECT public.reserve_x_media_uploads('00000000-0000-0000-0000-000000008030','00000000-0000-0000-0000-000000008031',1,2);"),
    sql("SELECT public.reserve_x_media_uploads('00000000-0000-0000-0000-000000008040','00000000-0000-0000-0000-000000008041',1,2);")
  ]);
  if (reservations.map(JSON.parse).filter(r => r.reserved).length !== 1) throw new Error('concurrent quota admission exceeded cap');
  if (await sql('SELECT public.get_x_media_upload_usage();') !== '4') throw new Error('concurrent quota usage mismatch');
  console.log('PASS concurrent whole-batch quota admission');
} finally {
  if (!id) { try { id = (await readFile(cidfile, 'utf8')).trim(); } catch {} }
  if (id) {
    const [owned] = JSON.parse(await docker(['inspect', id]));
    if (owned.Config.Labels[label] !== name) throw new Error('cleanup refused: ownership mismatch');
    await docker(['rm', '-f', '-v', id]);
    const remaining = await docker(['ps', '-aq', '--filter', `id=${id}`]);
    if (remaining) throw new Error('disposable database cleanup failed');
    console.log('Disposable database removed. No production database was contacted.');
  }
  await rm(temp, { recursive: true, force: true });
}
