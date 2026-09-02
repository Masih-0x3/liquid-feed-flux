import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [observedLocalDir, candidateLocalDir, remotePath, outputPath] = process.argv.slice(2);
if (!observedLocalDir || !candidateLocalDir || !remotePath || !outputPath) {
  throw new Error('usage: node build-xot-migration-manifest.mjs OBSERVED_LOCAL_DIR CANDIDATE_LOCAL_DIR REMOTE_JSON OUTPUT_JSON');
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalize = (value) => value
  .replace(/\r\n?/g, '\n')
  .replace(/--[^\n]*/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/;/g, '')
  .replace(/\s*([(),=])\s*/g, '$1')
  .trim()
  .toLowerCase();

// This normalizer is intentionally diagnostic-only. It is not SQL-lexical and
// therefore cannot prove semantic equivalence for quoted or dollar-quoted data.

function readLocal(dir) {
  return fs.readdirSync(dir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .sort()
    .map((filename) => {
      const body = fs.readFileSync(path.join(dir, filename), 'utf8');
      return {
        side: 'local',
        version: filename.slice(0, 14),
        name: filename.slice(15, -4),
        path: `supabase/migrations/${filename}`,
        sha256: sha256(body),
        sha256_without_terminal_lf: sha256(body.endsWith('\n') ? body.slice(0, -1) : body),
        normalized_sha256: sha256(normalize(body)),
        body_available: true,
      };
    });
}

const observedLocal = readLocal(observedLocalDir);
const candidateLocal = readLocal(candidateLocalDir);
const remoteRaw = fs.readFileSync(remotePath, 'utf8');
const remotePayload = JSON.parse(remoteRaw);
if (remotePayload.export_contract !== 'xot-remote-migration-snapshot-v1') throw new Error('remote export contract missing');
if (remotePayload.project_ref !== 'jzirqfzzvlbxwfzndaer') throw new Error('remote export project mismatch');
if (!remotePayload.captured_at || Number.isNaN(Date.parse(remotePayload.captured_at))) throw new Error('remote export timestamp missing');
if (remotePayload.source?.service !== 'postgres'
  || remotePayload.source?.relation !== 'supabase_migrations.schema_migrations'
  || remotePayload.source?.statement_serialization !== 'statements.join(LF)'
  || remotePayload.source?.capture_tool !== 'supabase-mcp:execute_sql'
  || !/^[a-f0-9]{64}$/.test(remotePayload.source?.query_sha256 ?? '')) {
  throw new Error('remote export source/query metadata missing');
}
const remote = remotePayload.rows.map((row) => {
  const statements = Array.isArray(row.statements) ? row.statements : [];
  const body = statements.join('\n');
  return {
    side: 'remote',
    version: String(row.version),
    name: row.name || null,
    sha256: sha256(body),
    normalized_sha256: sha256(normalize(body)),
    body_available: statements.length > 0,
    statement_count: statements.length,
    body_bytes: Buffer.byteLength(body),
  };
});

const manualPairs = new Map([
  ['20250902172822', { remote:'20250902052820', disposition:'superseded_operational_definition', evidence:'same cron intent; remote embeds a legacy anon JWT while local resolves runtime anon_key; current live legacy job absent' }],
  ['20250902173238', { remote:'20250902053237', disposition:'superseded_operational_definition', evidence:'same cron intent; remote embeds a legacy anon JWT while local resolves runtime anon_key; current live legacy job absent' }],
  ['20250902234705', { remote:'20250902114704', disposition:'superseded_operational_definition', evidence:'same worker trigger intent; remote embeds a legacy anon JWT while local resolves runtime anon_key; current live legacy trigger path superseded' }],
  ['20250902234736', { remote:'20250902114735', disposition:'superseded_operational_definition', evidence:'same search_path hardening intent; remote embeds a legacy anon JWT while local resolves runtime anon_key; current live legacy trigger path superseded' }],
  ['20250903015813', { remote:'20250903015811', disposition:'superseded_operational_definition', evidence:'same pending-job cron intent; remote embeds a legacy anon JWT while local resolves runtime anon_key; current live legacy job absent' }],
  ['20260226203309', { remote:'20260226203308', disposition:'superseded_operational_definition', evidence:'same scheduled invocation intent; literal auth material differs; current live definition is later internal-header implementation' }],
  ['20260413144422', { remote:'20260413144420', disposition:'superseded_operational_definition', evidence:'same scheduled invocation family; literal auth material differs; current live definitions use internal headers' }],
  ['20260418135312', { remote:'20260418135310', disposition:'superseded_operational_definition', evidence:'same scheduled invocation family; literal auth material differs; later definitions own live behavior' }],
  ['20260418152635', { remote:'20260418152633', disposition:'superseded_operational_definition', evidence:'same scheduled invocation family; literal auth material differs; later definitions own live behavior' }],
  ['20260425094604', { remote:'20260425094602', disposition:'superseded_operational_definition', evidence:'same scheduled invocation family; literal auth material differs; later definitions own live behavior' }],
  ['20260508000554', { remote:'20260508000552', disposition:'superseded_operational_definition', evidence:'same scheduled invocation family; literal auth material differs; later definitions own live behavior' }],
  ['20260514120000', { remote:'20260513223207', disposition:'remote_body_subset_live_effect_reconciled', evidence:'shared feedback schema/functions match; local also contains cleanup_old_data, whose live definition matches replay but is absent from the remote ledger body' }],
  ['20260514160000', { remote:'20260514163302', disposition:'schema_equivalent_runtime_seed_superseded', evidence:'schema objects match; enrichment_config seed differs and is superseded by the current typed runtime setting' }],
  ['20250903140000', { remote:'20250904033146', disposition:'renamed_comment_only_equivalent_pending_archive_approval', evidence:'direct raw line diff shows only one SQL line comment and trailing blank lines; remote source is restored modulo one repository terminal LF', candidate_action:'archive_alias_and_restore_remote_version' }],
  ['20260515080625', { remote:'20260515080625', disposition:'security_privilege_divergence', evidence:'local revokes authenticated access and grants service-role-only access; remote grants authenticated SELECT', candidate_action:'retain_restrictive_local_source_and_author_reviewed_forward_privilege_fix' }],
  ['20260515084409', { remote:'20260515084409', disposition:'security_privilege_divergence', evidence:'local revokes authenticated table access while remote grants authenticated SELECT; function grants otherwise align', candidate_action:'retain_restrictive_local_source_and_author_reviewed_forward_privilege_fix' }],
  ['20260515104839', { remote:'20260515104839', disposition:'security_privilege_divergence', evidence:'local grants RPC execution only to service_role while remote also grants authenticated execution', candidate_action:'retain_restrictive_local_source_and_author_reviewed_forward_privilege_fix' }],
  ['20260516021358', { remote:'20260516021358', disposition:'security_privilege_divergence', evidence:'local revokes authenticated table access while remote grants authenticated DML on scoring tables', candidate_action:'retain_restrictive_local_source_and_author_reviewed_forward_privilege_fix' }],
  ['20260516050042', { remote:'20260516050042', disposition:'remote_body_missing_effect_observed_pending_approval', evidence:'remote ledger row has no statements; local grant effects match the live snapshot, but body equivalence is unprovable', candidate_action:'retain_local_source_and_author_reviewed_forward_privilege_fix' }],
]);

const localSpecial = new Map([
  ['20260609201533', { disposition:'live_schema_equivalent_unledgered_local', evidence:'video render tables, policies, functions, triggers and grants match production; no remote migration row contains the source body' }],
  ['20260609213357', { disposition:'live_schema_equivalent_unledgered_local', evidence:'scoring tuning objects and resulting schema match production; no remote migration row contains the source body' }],
]);
const remoteSpecial = new Map([
  ['20250904033120', { disposition:'source_restored_candidate', evidence:'remote add_core_pipeline_columns body restored before the RPC, modulo one repository terminal LF' }],
  ['20250905010114', { disposition:'source_restored_candidate', evidence:'remote telegram_analytics body restored modulo one repository terminal LF' }],
]);

const remoteByRaw = new Map(remote.map((entry) => [entry.sha256, entry]));
const remoteByNormalized = new Map();
for (const entry of remote) {
  const list = remoteByNormalized.get(entry.normalized_sha256) ?? [];
  list.push(entry);
  remoteByNormalized.set(entry.normalized_sha256, list);
}
const usedRemote = new Set();
const decisions = new Map();

for (const entry of observedLocal) {
  let match = remoteByRaw.get(entry.sha256);
  let decision;
  if (match && !usedRemote.has(match.version)) {
    decision = {
      remote: match.version,
      disposition: entry.version === match.version ? 'exact_equivalent' : 'renamed_exact_equivalent',
      evidence: 'raw SQL body SHA-256 is identical',
    };
  } else {
    const manual = manualPairs.get(entry.version);
    if (manual) {
      decision = manual;
      match = remote.find((candidate) => candidate.version === decision.remote);
    } else {
      const normalizedMatches = (remoteByNormalized.get(entry.normalized_sha256) ?? []).filter((candidate) => !usedRemote.has(candidate.version));
      if (normalizedMatches.length === 1) {
        match = normalizedMatches[0];
        decision = {
          remote: match.version,
          disposition: entry.version === match.version
            ? 'same_version_normalized_match_pending_semantic_review'
            : 'renamed_normalized_match_pending_semantic_review',
          evidence: 'non-lexical normalized hashes match, but this is diagnostic only; statement-aware review and live-effect proof are still required',
        };
      }
    }
  }
  if (decision && match && !usedRemote.has(match.version)) {
    usedRemote.add(match.version);
    decisions.set(`local:${entry.version}`, { ...decision, counterpart:`remote:${match.version}` });
    decisions.set(`remote:${match.version}`, { ...decision, counterpart:`local:${entry.version}` });
    continue;
  }
  const special = localSpecial.get(entry.version);
  if (!special) throw new Error(`Unclassified observed local migration ${entry.version}`);
  decisions.set(`local:${entry.version}`, { ...special, counterpart:null });
}

for (const entry of remote) {
  if (usedRemote.has(entry.version)) continue;
  const special = remoteSpecial.get(entry.version);
  if (!special) throw new Error(`Unclassified remote migration ${entry.version}`);
  decisions.set(`remote:${entry.version}`, { ...special, counterpart:`candidate-local:${entry.version}` });
}

const observedEntries = [...observedLocal, ...remote]
  .map((entry) => {
    const id = `${entry.side}:${entry.version}`;
    const decision = decisions.get(id);
    if (!decision) throw new Error(`Missing decision for ${id}`);
    const candidateAction = decision.candidate_action ?? (id === 'local:20250903140000'
      ? 'archive_alias_and_restore_remote_version'
      : id === 'remote:20250904033146'
        ? 'restore_exact_remote_version'
        : id === 'remote:20250904033120' || id === 'remote:20250905010114'
          ? 'restore_exact_remote_source'
          : 'retain_or_document');
    const reviewStatus = ['exact_equivalent','renamed_exact_equivalent'].includes(decision.disposition)
      ? 'hash_proven'
      : 'candidate_pending_owner_review';
    const result = {
      id,
      ...entry,
      counterpart_id: decision.counterpart,
      disposition: decision.disposition,
      evidence: decision.evidence,
      candidate_action: candidateAction,
      review_status: reviewStatus,
      review: reviewStatus === 'hash_proven'
        ? {reviewer:'automation:scripts/check-migration-baseline.mjs',reviewed_at:remotePayload.captured_at,evidence_receipt:'reciprocal raw SHA-256 equality'}
        : {reviewer:'pending:database-owner',reviewed_at:null,evidence_receipt:null},
    };
    if (id === 'local:20250903140000') {
      result.current_source_state = 'retired_from_candidate_executable_chain';
      result.retired_alias = 'supabase/migration-history/20250903140000_rpc_pipeline_status_and_retry.sql';
    }
    if (id === 'remote:20250904033120') {
      result.current_source_state = 'restored_to_candidate_executable_chain';
      result.restored_local_path = 'supabase/migrations/20250904033120_add_core_pipeline_columns.sql';
    }
    if (id === 'remote:20250904033146') {
      result.current_source_state = 'restored_to_candidate_executable_chain';
      result.restored_local_path = 'supabase/migrations/20250904033146_rpc_pipeline_status_and_retry.sql';
    }
    if (id === 'remote:20250905010114') {
      result.current_source_state = 'restored_to_candidate_executable_chain';
      result.restored_local_path = 'supabase/migrations/20250905010114_telegram_analytics.sql';
    }
    if (id === 'local:20260609201533' || id === 'local:20260609213357') {
      result.unmatched_reason = 'no_remote_ledger_row_live_effect_candidate';
      result.live_effect_receipt = '2026-07-14 canonical public-schema comparison; owner approval still required';
    }
    return result;
  })
  .sort((a,b) => a.side.localeCompare(b.side) || a.version.localeCompare(b.version));

const candidateByVersion = new Map(candidateLocal.map((entry) => [entry.version, entry]));
for (const version of ['20250904033120','20250904033146','20250905010114']) {
  const candidate = candidateByVersion.get(version);
  const remoteEntry = remote.find((entry) => entry.version === version);
  if (!candidate || !remoteEntry || (candidate.sha256 !== remoteEntry.sha256 && candidate.sha256_without_terminal_lf !== remoteEntry.sha256)) {
    throw new Error(`Candidate restoration mismatch for ${version}`);
  }
}
if (candidateByVersion.has('20250903140000')) throw new Error('Demoted local alias remains executable');

const manifest = {
  schema_version:'xot-migration-equivalence-manifest-v1',
  observed_at:'2026-07-14T09:42:38Z',
  generated_at:remotePayload.captured_at,
  project_ref:'jzirqfzzvlbxwfzndaer',
  observation_anchor:{git_head:'ec05e331107ad76d10f129cb2e3fa24e9ea320b2',branch:'codex/emilyui',observed_at:'2026-07-14T09:42:38Z'},
  candidate_base_anchor:{git_head:'fa3fa0eccb7b2166b0b7d8dbd596091647bd3e26',branch:'codex/xot-sr-mig-01'},
  methodology:{generator:'scripts/build-migration-equivalence-manifest.mjs',generator_version:2,tool_versions:{node:'22.23.1',supabase_cli:'2.109.1',docker:'29.6.1',postgres_image:'public.ecr.aws/supabase/postgres:17.6.1.143'},protected_input_hashes:{manifest_generator_sha256:sha256(fs.readFileSync(new URL(import.meta.url))),observed_local_inventory_sha256:sha256(JSON.stringify(observedLocal.map(({version,name,sha256})=>({version,name,sha256})))),candidate_local_inventory_sha256:sha256(JSON.stringify(candidateLocal.map(({version,name,sha256})=>({version,name,sha256})))),remote_export_sha256:sha256(remoteRaw)}},
  safety:{remote_mutations_performed:false,db_push_performed:false,migration_repair_performed:false,raw_remote_export_committed:false,restored_remote_source_bodies_committed:3,secret_bearing_restored_source_bodies_committed:0},
  normalization_contract:{classification:'diagnostic_only',algorithm:'LF; remove SQL comments; collapse whitespace; remove semicolon terminators; lowercase entire input',warning:'not SQL-lexical; quoted and dollar-quoted content can be changed, so normalized matches are never equivalence proof'},
  counts:{observed_local:observedLocal.length,observed_remote:remote.length,observed_side_entries:observedEntries.length,unique_observed_versions:new Set(observedEntries.map((entry)=>entry.version)).size,candidate_active_local:candidateLocal.length},
  candidate:{
    status:'schema_replay_passed_egress_isolation_unproven_pending_owner_and_restore_gate',
    removed_active_versions:['20250903140000'],
    restored_remote_versions:['20250904033120','20250904033146','20250905010114'],
    active_versions:candidateLocal.map((entry)=>entry.version),
    active_source_hashes:Object.fromEntries(candidateLocal.map((entry)=>[entry.version,entry.sha256])),
    replay:{runs:2,schema_result:'pass',acceptance_result:'rejected_pending_safe_rerun',through_version:'20260703013000',outbound_isolation:'unproven',local_stack_state:'stopped',prerequisite_columns:12,prerequisite_indexes:5,pipeline_rpc_output_columns:20,transactional_retry_probe_rolled_back:true,production_gateway_observation:{window_events:100,rejected_worker_requests:2,status:401,timestamps_utc:['2026-07-14T10:09:01.913Z','2026-07-14T10:10:01.044Z'],attribution:'timing_and_cadence_inference_not_source_ip_proof',side_effect_assessment:'gateway rejection; no worker execution evidenced'}},
    recovery:{status:'blocked_no_restore_drill',pitr_enabled:false,daily_backup_records:7},
    privilege_review:{status:'blocked_material_diff',differing_records:105,production_broader_records:105,replay_broader_records:0,different_records:0,default_privilege_replay_only:6,default_privilege_production_only:7},
    remote_body_resolution:{status:'blocked_missing_source',version:'20260516050042'},
    hosted_ci:{status:'blocked_external_billing'},
    schema_diff:{replay_sha256:'6871e7d3a6a7fa10f5020da3cefed942b536946f6cb74171391eaf9f5fbff3ce',production_sha256:'22463e4173f21c7ad2e1da82d474237c04c6a3872513f4ce73a5eeb741d8ec44',non_privilege_sha256:'3467c722833038deb89235eb8d7b2d97e70f19c19d2eb4fef59188dffb46ba0b',semantic_object_diff:'expected_empty',privilege_diff:'material_review_required'},
    generated_types:{replay_sha256:'bf9997e5205477de1c1ee54ed075388e819d55079e754264f7446b0509632a70',production_sha256:'4962fd13d2ed91541b64c1ffba5c8dd28dd8fbe71f5dea6730e25bb10eb9763b',checked_in_sha256:'6f1633354c06a2bbcb475fe6f53ad1f08bd44c1a6b167f672f513090e2b436a8',replay_vs_production:'schema-identical; production adds PostgREST 14.5 metadata header',checked_in_status:'stale'},
  },
  blockers:[
    {id:'replay-egress',status:'blocked',reason:'historical pg_cron/pg_net migrations could reach production; rerun requires a no-egress or loopback-only receipt'},
    {id:'restore-readiness',status:'blocked',reason:'PITR disabled and no successful restore drill receipt'},
    {id:'owner-review',status:'blocked',reason:'semantic, unledgered and restored-source dispositions require database-owner approval'},
    {id:'remote-body-missing',status:'blocked',reason:'remote migration 20260516050042 has no source body; live-effect observation does not prove body equivalence'},
    {id:'privilege-drift',status:'blocked',reason:'production grants are materially broader than the replay and require SR-RLS-01 review'},
    {id:'types-stale',status:'blocked',reason:'checked-in generated types do not match the approved linked/replay schema contract'},
    {id:'hosted-ci',status:'blocked',reason:'GitHub Actions cannot start because of account billing/spending state'},
  ],
  observed_entries:observedEntries,
};

if (manifest.counts.observed_side_entries !== 210) throw new Error(`Expected 210 observed side entries, got ${manifest.counts.observed_side_entries}`);
fs.writeFileSync(outputPath, `${JSON.stringify(manifest,null,2)}\n`);
console.log(JSON.stringify({output:outputPath,counts:manifest.counts,blockers:manifest.blockers.map((item)=>item.id)}));
