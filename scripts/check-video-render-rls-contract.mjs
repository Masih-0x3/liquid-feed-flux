import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const typescript = require('typescript');
const root = resolve(process.cwd());
const migrationName = '20260723173100_lock_down_video_render_raw_tables.sql';
const e7MigrationName = '20260811090000_revoke_public_default_privileges.sql';
const migrationPath = join(root, 'supabase', 'migrations', migrationName);
const videoPipelinePath = join(root, 'supabase', 'migrations', '20260609201533_video_render_pipeline.sql');
const manualIntakesPath = join(root, 'supabase', 'migrations', '20260629010000_manual_video_intakes.sql');
const feedbackRevisionPath = join(root, 'supabase', 'migrations', '20260722162000_video_render_feedback_revision.sql');
const rendererConfigPath = join(root, 'services', 'video-renderer', 'src', 'config.js');
const rendererPath = join(root, 'services', 'video-renderer', 'src', 'renderer.js');
const adminActionsPath = join(root, 'supabase', 'functions', 'admin-actions', 'index.ts');
const adminClientPath = join(root, 'src', 'api', 'adminActions.ts');
const sourceRoot = join(root, 'src');
const publicRoot = join(root, 'public');
const indexHtmlPath = join(root, 'index.html');
const monitoringRealtimePath = join(root, 'src', 'lib', 'monitoringRealtime.ts');

const expectedMonitoringRealtimeTables = [
  'posts',
  'jobs',
  'deliveries',
  'x_deliveries',
  'workflow_runs',
  'ai_call_ledger',
];

const tables = [
  {
    table: 'video_renders',
    legacyPolicies: [
      'Users can view video renders',
      'Authenticated can view video renders',
      'Admins can manage video renders',
      'Authenticated can manage video renders',
      'Service role can manage video renders',
    ],
    servicePolicy: 'Service role can manage video renders',
    actions: ['get_video_render_overview', 'get_video_render_queue', 'get_video_render_detail', 'retry_video_render', 'set_video_render_reviewed', 'save_video_render_feedback'],
  },
  {
    table: 'video_render_feedback',
    legacyPolicies: [
      'Users can view video render feedback',
      'Authenticated can view video render feedback',
      'Admins can manage video render feedback',
      'Authenticated can manage video render feedback',
      'Service role can manage video render feedback',
    ],
    servicePolicy: 'Service role can manage video render feedback',
    actions: ['get_video_render_detail', 'save_video_render_feedback'],
  },
  {
    table: 'video_renderer_heartbeats',
    legacyPolicies: [
      'Users can view video renderer heartbeats',
      'Authenticated can view video renderer heartbeats',
      'Admins can manage video renderer heartbeats',
      'Authenticated can manage video renderer heartbeats',
      'Service role can manage video renderer heartbeats',
    ],
    servicePolicy: 'Service role can manage video renderer heartbeats',
    actions: ['get_video_render_overview'],
  },
  {
    table: 'manual_video_intakes',
    legacyPolicies: [
      'Users can view manual video intakes',
      'Authenticated can view manual video intakes',
      'Admins can manage manual video intakes',
      'Authenticated can manage manual video intakes',
      'Service role can manage manual video intakes',
    ],
    servicePolicy: 'Service role can manage manual video intakes',
    actions: [
      'manual_video_intake_create',
      'manual_video_intake_get',
      'manual_video_intake_list',
      'manual_video_intake_refresh',
      'manual_video_intake_save_caption',
      'manual_video_intake_set_duplicate_override',
      'manual_video_intake_cancel',
      'manual_video_intake_post',
    ],
  },
];

const serviceOnlyRpcs = [
  ['videoPipeline', 'public._video_render_should_release(text)'],
  ['videoPipeline', 'public._video_render_queue_delivery(text,text)'],
  ['videoPipeline', 'public.enqueue_video_render(text,uuid,text,text)'],
  ['videoPipeline', 'public.claim_video_renders(integer,text)'],
  ['videoPipeline', 'public.claim_video_render_by_id(uuid,text)'],
  ['videoPipeline', 'public.complete_video_render(uuid,text,bigint,text,text,text,jsonb,integer,integer,integer,text,text,text,jsonb)'],
  ['videoPipeline', 'public.block_video_render(uuid,text,jsonb,jsonb)'],
  ['videoPipeline', 'public.fail_video_render(uuid,text,jsonb)'],
  ['videoPipeline', 'public.mark_video_render_posted(text,integer)'],
  ['videoPipeline', 'public.get_expired_video_render_paths(integer)'],
  ['videoPipeline', 'public.mark_video_renders_expired(uuid[])'],
  ['manualIntakes', 'public._video_render_should_release(text)'],
  ['manualIntakes', 'public.get_x_post_candidates(integer,text)'],
  ['feedbackRevision', 'public.save_video_render_feedback_if_current(uuid,text,bigint,text,text,jsonb,uuid)'],
];

// These are the exact successor migrations present after the raw-video
// lockdown. They are deliberately kept separate from the non-raw caller-bound
// exemption below: B4 changes the protected renderer RPCs and is validated as
// part of this contract, never treated as an unrelated migration.
const postLockdownMigrationDigests = new Map([
  ['20260730070000_telegram_delivery_claims.sql', '94531ca09a843f2ea00c05adcd0de0d1787305df431d4c161212c95773a8bcf2'],
  ['20260806123000_media_object_cleanup_claims.sql', 'f830ed38a7b190ef01aa747f5cefbb315963d304fd097154b35c293ad8abf4ef'],
  ['20260806143000_b3_job_x_claim_fencing.sql', '024dc8569aa490d9050d63b4507e584a9ffba5cb255bc3df9e76e24a64b84ecd'],
  ['20260806153000_b3b1_rss_webhook_receipts.sql', 'c33231946eddcc7b97f8a6edd33f3c8527f6f3fa32008181c882bec042de9b46'],
  ['20260808110000_b3b2_digest_checkpoints.sql', '83bc88b93f5017c8f664eac2b5abadbba8b0e559b71e8117862fc35ea2089758'],
  ['20260808123000_b4_video_render_claim_fencing.sql', '24957228d1facffbcf5e737de0f1c3c349da0a3dc1d4defb8d1915d2ae15bdf4'],
  ['20260808133000_b2b_media_object_deletion_token_uuid.sql', 'b25a0f0367a5fe34783a29b0e2837d56fc89d5f1bff0e423ef0f1f87286eb364'],
  ['20260808143000_b3a_reconcile_expired_job_claims_fix.sql', 'a126f3f1268bd710bc420861974915eb7adbbae03ce94e7329eeb335ab1a3c20'],
  ['20260808153000_b3a_fail_x_post_delivery_null_fix.sql', 'c95c09cbfef0d7bc44a0640383f9ad4a23297701d75126d46155ab928a9b44b5'],
  ['20260808163000_b3a_claim_x_ambiguous_retry_fix.sql', 'ad4d0e56f652f7df0b5d40b8258643b099e76ea5cb51b8b4d9d42fe380184807'],
  ['20260808173000_b3a_claim_x_ambiguous_history_fix.sql', '74b69c207ef81d76fc6a0e800d9105c05aa61b69d4d8818ec252dc7ba29af555'],
  [e7MigrationName, 'fec67e19b6e47534e6b9c7cd7b6b33735fdf26cce74204c8d1e5862b4f8446e8'],
]);

function read(path) {
  return readFileSync(path, 'utf8');
}

function sqlFunctionCallBodies(source, functionName) {
  const callPattern = new RegExp(`\\b${functionName}\\s*\\(`, 'gi');
  const bodies = [];
  for (const match of source.matchAll(callPattern)) {
    const openParen = (match.index ?? 0) + match[0].length - 1;
    let depth = 1;
    let quote = null;
    let bodyEnd = -1;
    for (let index = openParen + 1; index < source.length; index += 1) {
      const character = source[index];
      if (quote === "'") {
        if (character === "'" && source[index + 1] === "'") {
          index += 1;
        } else if (character === "'") {
          quote = null;
        }
        continue;
      }
      if (quote === '"') {
        if (character === '"' && source[index + 1] === '"') {
          index += 1;
        } else if (character === '"') {
          quote = null;
        }
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
      } else if (character === '(') {
        depth += 1;
      } else if (character === ')') {
        depth -= 1;
        if (depth === 0) {
          bodyEnd = index;
          break;
        }
      }
    }
    if (bodyEnd >= 0) bodies.push(source.slice(openParen + 1, bodyEnd));
  }
  return bodies;
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?)$/i.test(entry.name) ? [path] : [];
  });
}

function htmlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return /\.html?$/i.test(entry.name) ? [path] : [];
  });
}

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return /\.css$/i.test(entry.name) ? [path] : [];
  });
}

function svgFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return svgFiles(path);
    return /\.svg$/i.test(entry.name) ? [path] : [];
  });
}

function inlineBrowserScriptsFromHtml(path, html, inheritedBaseHref = null, depth = 0, context = '') {
  const files = [];
  const tags = staticHtmlOpenTags(html);
  const localBaseHref = staticHtmlBaseHref(tags);
  const documentBaseHref = localBaseHref
    ? resolveStaticHtmlUrl(localBaseHref, inheritedBaseHref)
    : inheritedBaseHref;
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptIndex = 0;
  for (const match of html.matchAll(scriptPattern)) {
    const attributes = match[1];
    const source = match[2];
    const src = attributes.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const externalSource = src?.[1] ?? src?.[2] ?? src?.[3] ?? null;
    if (externalSource) {
      files.push({
        path: `${relative(root, path)}${context}:external-script-${scriptIndex}.js`,
        source: `import ${JSON.stringify(externalSource)};`,
        documentBaseHref,
      });
    }
    if (source.trim()) {
      files.push({
        path: `${relative(root, path)}${context}:inline-script-${scriptIndex}.js`,
        source,
        documentBaseHref,
      });
    }
    scriptIndex += 1;
  }
  let srcdocIndex = 0;
  for (const tag of tags) {
    const srcdoc = staticHtmlAttributeValues(tag.attributes).find((attribute) => attribute.name === 'srcdoc')?.value;
    if (typeof srcdoc !== 'string') continue;
    if (depth >= 8) {
      files.push({
        path: `${relative(root, path)}${context}:srcdoc-script-depth-${srcdocIndex}.js`,
        source: `fetch('/rest/v1/unreviewed-srcdoc-nesting');`,
        documentBaseHref,
      });
    } else {
      files.push(...inlineBrowserScriptsFromHtml(
        path,
        srcdoc,
        documentBaseHref,
        depth + 1,
        `${context}:srcdoc-${srcdocIndex}`,
      ));
    }
    srcdocIndex += 1;
  }
  return files;
}

function inlineBrowserScripts(path) {
  const html = read(path);
  return inlineBrowserScriptsFromHtml(path, html);
}

function decodeHtmlAttributeValue(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .replace(/&#([0-9]+);?/g, (_match, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&colon;/gi, ':')
    .replace(/&sol;/gi, '/')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&amp;/gi, '&');
}

function staticHtmlOpenTags(html) {
  const tags = [];
  const uncommentedHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  // `>` is legal inside quoted attribute values (notably iframe `srcdoc`).
  // Consume quoted spans atomically so nested markup remains an attribute of
  // the outer tag instead of truncating the static inspection.
  const tagPattern = /<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  for (const match of uncommentedHtml.matchAll(tagPattern)) {
    tags.push({
      name: match[1].toLowerCase(),
      attributes: match[2],
    });
  }
  return tags;
}

function staticHtmlAttributeValues(attributes) {
  const values = [];
  const attributePattern = /(?:^|\s)([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  for (const match of attributes.matchAll(attributePattern)) {
    values.push({
      name: match[1].toLowerCase(),
      value: decodeHtmlAttributeValue(match[2] ?? match[3] ?? match[4] ?? ''),
    });
  }
  return values;
}

function staticHtmlBaseHref(tags) {
  for (const tag of tags) {
    if (tag.name !== 'base') continue;
    const href = staticHtmlAttributeValues(tag.attributes).find((attribute) => attribute.name === 'href')?.value;
    if (href) return href;
  }
  return null;
}

function resolveStaticHtmlUrl(value, baseHref) {
  try {
    const documentUrl = new URL('https://xot.invalid/');
    const baseUrl = baseHref ? new URL(baseHref, documentUrl) : documentUrl;
    return new URL(value, baseUrl).href;
  } catch {
    // Keep the original value for the raw-endpoint matcher when malformed HTML
    // cannot be resolved the same way as an ordinary browser navigation.
    return value;
  }
}

function staticHtmlMetaRefreshUrl(value) {
  const match = value.match(/(?:^|;)\s*url\s*=\s*([\s\S]*)$/i);
  if (!match) return value;
  const url = match[1].trim();
  if (
    (url.startsWith('"') && url.endsWith('"'))
    || (url.startsWith("'") && url.endsWith("'"))
  ) return url.slice(1, -1);
  return url;
}

function staticHtmlResourceUrls(attribute, value) {
  if (attribute === 'ping') return value.trim().split(/\s+/).filter(Boolean);
  if (attribute !== 'srcset' && attribute !== 'imagesrcset') return [value];
  // `srcset` may issue a request for any candidate, not just its first URL.
  // Descriptor whitespace is not part of the URL; data URLs are irrelevant to
  // the raw PostgREST route and intentionally stay fail-closed if malformed.
  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0] ?? '')
    .filter(Boolean);
}

function decodeCssUrlValue(value) {
  return value
    .trim()
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .replace(/\\([\s\S])/g, '$1');
}

function staticCssResourceUrls(css) {
  const urls = [];
  const uncommentedCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const urlPattern = /url\(\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\s)'"\\][^)]*))\s*\)/gi;
  for (const match of uncommentedCss.matchAll(urlPattern)) {
    const value = decodeCssUrlValue(match[1] ?? match[2] ?? match[3] ?? '');
    if (value) urls.push(value);
  }
  const importPattern = /@import\s+(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)')/gi;
  for (const match of uncommentedCss.matchAll(importPattern)) {
    const value = decodeCssUrlValue(match[1] ?? match[2] ?? '');
    if (value) urls.push(value);
  }
  const imageSetPattern = /(?:-webkit-)?image-set\(\s*([\s\S]*?)\)/gi;
  for (const imageSet of uncommentedCss.matchAll(imageSetPattern)) {
    const quotedCandidatePattern = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'/g;
    for (const candidate of imageSet[1].matchAll(quotedCandidatePattern)) {
      const value = decodeCssUrlValue(candidate[1] ?? candidate[2] ?? '');
      if (value) urls.push(value);
    }
  }
  return urls;
}

function staticCssResourceAttributesFromCss(path, css, baseHref = null, context = 'css') {
  return staticCssResourceUrls(css).map((value, index) => ({
    path: `${relative(root, path)}:${context}-url-${index}.js`,
    source: '',
    staticHtmlResourceAttribute: 'css-url',
    staticHtmlResourceUrl: value,
    staticHtmlResolvedResourceUrl: resolveStaticHtmlUrl(value, baseHref),
  }));
}

function staticHtmlStyleBlocks(html) {
  const blocks = [];
  const stylePattern = /<style\b(?:(?:"[^"]*")|(?:'[^']*')|[^'">])*>([\s\S]*?)<\/style\s*>/gi;
  for (const match of html.matchAll(stylePattern)) blocks.push(match[1]);
  return blocks;
}

function staticHtmlResourceAttributesFromHtml(path, html, inheritedBaseHref = null, depth = 0, context = '') {
  const resources = [];
  const resourceAttributeNames = new Set(['src', 'srcset', 'imagesrcset', 'href', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'ping', 'background']);
  const tags = staticHtmlOpenTags(html);
  const localBaseHref = staticHtmlBaseHref(tags);
  const baseHref = localBaseHref
    ? resolveStaticHtmlUrl(localBaseHref, inheritedBaseHref)
    : inheritedBaseHref;
  let index = 0;
  for (const tag of tags) {
    const attributes = staticHtmlAttributeValues(tag.attributes);
    const isContentSecurityPolicyMeta = (
      tag.name === 'meta'
      && attributes.some((attribute) => (
        attribute.name === 'http-equiv'
        && attribute.value.trim().toLowerCase() === 'content-security-policy'
      ))
    );
    for (const attribute of attributes) {
      if (isContentSecurityPolicyMeta) continue;
      if (attribute.name === 'srcdoc') {
        if (depth >= 8) {
          // There is no reviewed need for deeply nested browser documents.
          // Fail closed rather than silently ignoring a resource sink below
          // the bounded static parser's recursion limit.
          resources.push({
            path: `${relative(root, path)}${context}:srcdoc-depth-${index}.js`,
            source: '',
            staticHtmlResourceAttribute: 'srcdoc',
            staticHtmlResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
            staticHtmlResolvedResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
          });
          index += 1;
          continue;
        }
        resources.push(...staticHtmlResourceAttributesFromHtml(
          path,
          attribute.value,
          baseHref,
          depth + 1,
          `${context}:srcdoc-${index}`,
        ));
        index += 1;
        continue;
      }
      if (attribute.name === 'style') {
        resources.push(...staticCssResourceAttributesFromCss(
          path,
          attribute.value,
          baseHref,
          `${context}:style-attribute-${index}`,
        ));
        index += 1;
        continue;
      }
      if (!resourceAttributeNames.has(attribute.name)) continue;
      for (const value of staticHtmlResourceUrls(attribute.name, attribute.value)) {
        resources.push({
          path: `${relative(root, path)}${context}:resource-${attribute.name}-${index}.js`,
          source: '',
          staticHtmlResourceAttribute: attribute.name,
          staticHtmlResourceUrl: value,
          staticHtmlResolvedResourceUrl: resolveStaticHtmlUrl(value, baseHref),
        });
        index += 1;
      }
    }
  }
  for (const [styleIndex, css] of staticHtmlStyleBlocks(html).entries()) {
    resources.push(...staticCssResourceAttributesFromCss(
      path,
      css,
      baseHref,
      `${context}:style-block-${styleIndex}`,
    ));
  }
  return resources;
}

function staticHtmlConfigurationAttributesFromHtml(path, html, inheritedBaseHref = null, depth = 0, context = '') {
  const configurations = [];
  const tags = staticHtmlOpenTags(html);
  const localBaseHref = staticHtmlBaseHref(tags);
  const baseHref = localBaseHref
    ? resolveStaticHtmlUrl(localBaseHref, inheritedBaseHref)
    : inheritedBaseHref;
  let index = 0;
  for (const tag of tags) {
    const attributes = staticHtmlAttributeValues(tag.attributes);
    const isContentSecurityPolicyMeta = (
      tag.name === 'meta'
      && attributes.some((attribute) => (
        attribute.name === 'http-equiv'
        && attribute.value.trim().toLowerCase() === 'content-security-policy'
      ))
    );
    for (const attribute of attributes) {
      if (isContentSecurityPolicyMeta) continue;
      if (attribute.name === 'srcdoc') {
        if (depth < 8) {
          configurations.push(...staticHtmlConfigurationAttributesFromHtml(
            path,
            attribute.value,
            baseHref,
            depth + 1,
            `${context}:srcdoc-${index}`,
          ));
        } else {
          configurations.push({
            path: `${relative(root, path)}${context}:configuration-srcdoc-depth-${index}.js`,
            source: '',
            staticHtmlResourceAttribute: 'configuration',
            staticHtmlResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
            staticHtmlResolvedResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
            staticHtmlConfigurationValue: true,
          });
        }
        index += 1;
        continue;
      }
      const compactValue = attribute.value.replace(/\s+/g, '');
      if (
        !/(?:^|\/)rest\/v1(?:[/?#]|$)/i.test(compactValue)
        && !/https?:\/\/[^\s"'`<>]*\.supabase\.co\b/i.test(compactValue)
      ) continue;
      configurations.push({
        path: `${relative(root, path)}${context}:configuration-${attribute.name}-${index}.js`,
        source: '',
        staticHtmlResourceAttribute: `configuration:${attribute.name}`,
        staticHtmlResourceUrl: attribute.value,
        staticHtmlResolvedResourceUrl: resolveStaticHtmlUrl(attribute.value, baseHref),
        staticHtmlConfigurationValue: true,
      });
      index += 1;
    }
  }
  return configurations;
}

function staticHtmlMetaRefreshesFromHtml(path, html, inheritedBaseHref = null, depth = 0, context = '') {
  const refreshes = [];
  const tags = staticHtmlOpenTags(html);
  const localBaseHref = staticHtmlBaseHref(tags);
  const baseHref = localBaseHref
    ? resolveStaticHtmlUrl(localBaseHref, inheritedBaseHref)
    : inheritedBaseHref;
  let index = 0;
  for (const tag of tags) {
    const attributes = new Map(staticHtmlAttributeValues(tag.attributes).map(({ name, value }) => [name, value]));
    const srcdoc = attributes.get('srcdoc');
    if (typeof srcdoc === 'string') {
      if (depth >= 8) {
        refreshes.push({
          path: `${relative(root, path)}${context}:meta-refresh-srcdoc-depth-${index}.js`,
          source: '',
          staticHtmlResourceAttribute: 'meta-refresh',
          staticHtmlResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
          staticHtmlResolvedResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
        });
      } else {
        refreshes.push(...staticHtmlMetaRefreshesFromHtml(
          path,
          srcdoc,
          baseHref,
          depth + 1,
          `${context}:srcdoc-${index}`,
        ));
      }
      index += 1;
    }
    if (tag.name !== 'meta') continue;
    if (attributes.get('http-equiv')?.trim().toLowerCase() !== 'refresh') continue;
    const content = attributes.get('content');
    if (typeof content !== 'string') continue;
    const value = staticHtmlMetaRefreshUrl(content);
    refreshes.push({
      path: `${relative(root, path)}${context}:meta-refresh-${index}.js`,
      source: '',
      staticHtmlResourceAttribute: 'meta-refresh',
      staticHtmlResourceUrl: value,
      staticHtmlResolvedResourceUrl: resolveStaticHtmlUrl(value, baseHref),
    });
    index += 1;
  }
  return refreshes;
}

function staticHtmlResourceAttributes(path) {
  return staticHtmlResourceAttributesFromHtml(path, read(path));
}

function staticSvgResourceAttributesFromSvg(path, svg) {
  // SVG image documents can be embedded with <object>, <embed>, or <iframe>.
  // Their external href/xlink:href and CSS URL sinks use the same syntax that
  // the static HTML resource parser already understands, so keep them in the
  // browser source contract instead of treating a local SVG URL as terminal.
  return staticHtmlResourceAttributesFromHtml(path, svg);
}

function staticSvgResourceAttributes(path) {
  return staticSvgResourceAttributesFromSvg(path, read(path));
}

function staticHtmlConfigurationAttributes(path) {
  return staticHtmlConfigurationAttributesFromHtml(path, read(path));
}

function staticHtmlTextConfigurationValuesFromHtml(path, html, depth = 0, context = '') {
  const configurations = [];
  const tags = staticHtmlOpenTags(html);
  let index = 0;
  for (const tag of tags) {
    const srcdoc = staticHtmlAttributeValues(tag.attributes).find((attribute) => attribute.name === 'srcdoc')?.value;
    if (typeof srcdoc !== 'string') continue;
    if (depth < 8) {
      configurations.push(...staticHtmlTextConfigurationValuesFromHtml(
        path,
        srcdoc,
        depth + 1,
        `${context}:srcdoc-${index}`,
      ));
    } else {
      configurations.push({
        path: `${relative(root, path)}${context}:text-srcdoc-depth-${index}.js`,
        source: '',
        staticHtmlResourceAttribute: 'text-configuration',
        staticHtmlResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
        staticHtmlResolvedResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
        staticHtmlConfigurationValue: true,
      });
    }
    index += 1;
  }
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const withoutTags = withoutComments.replace(/<\/?[a-z][\w:-]*\b(?:(?:"[^"]*")|(?:'[^']*')|[^'">])*>/gi, '');
  const value = decodeHtmlAttributeValue(withoutTags).replace(/\s+/g, '');
  if (
    /(?:^|\/)rest\/v1(?:[/?#]|$)/i.test(value)
    || /https?:\/\/[^\s"'`<>]*\.supabase\.co\b/i.test(value)
  ) {
    configurations.push({
      path: `${relative(root, path)}${context}:text-configuration-${index}.js`,
      source: '',
      staticHtmlResourceAttribute: 'text-configuration',
      staticHtmlResourceUrl: value,
      staticHtmlResolvedResourceUrl: value,
      staticHtmlConfigurationValue: true,
    });
  }
  return configurations;
}

function staticHtmlTextConfigurationValues(path) {
  return staticHtmlTextConfigurationValuesFromHtml(path, read(path));
}

function staticHtmlCommentConfigurationValuesFromHtml(path, html, depth = 0, context = '') {
  const configurations = [];
  let index = 0;
  for (const match of html.matchAll(/<!--([\s\S]*?)-->/g)) {
    const value = decodeHtmlAttributeValue(match[1]).replace(/\s+/g, '');
    if (
      /(?:^|\/)rest\/v1(?:[/?#]|$)/i.test(value)
      || /https?:\/\/[^\s"'`<>]*\.supabase\.co\b/i.test(value)
    ) {
      configurations.push({
        path: `${relative(root, path)}${context}:comment-configuration-${index}.js`,
        source: '',
        staticHtmlResourceAttribute: 'comment-configuration',
        staticHtmlResourceUrl: value,
        staticHtmlResolvedResourceUrl: value,
        staticHtmlConfigurationValue: true,
      });
    }
    index += 1;
  }
  for (const tag of staticHtmlOpenTags(html)) {
    const srcdoc = staticHtmlAttributeValues(tag.attributes).find((attribute) => attribute.name === 'srcdoc')?.value;
    if (typeof srcdoc !== 'string') continue;
    if (depth < 8) {
      configurations.push(...staticHtmlCommentConfigurationValuesFromHtml(
        path,
        srcdoc,
        depth + 1,
        `${context}:srcdoc-${index}`,
      ));
    } else {
      configurations.push({
        path: `${relative(root, path)}${context}:comment-srcdoc-depth-${index}.js`,
        source: '',
        staticHtmlResourceAttribute: 'comment-configuration',
        staticHtmlResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
        staticHtmlResolvedResourceUrl: '/rest/v1/unreviewed-srcdoc-nesting',
        staticHtmlConfigurationValue: true,
      });
    }
    index += 1;
  }
  return configurations;
}

function staticHtmlCommentConfigurationValues(path) {
  return staticHtmlCommentConfigurationValuesFromHtml(path, read(path));
}

function staticHtmlMetaRefreshes(path) {
  return staticHtmlMetaRefreshesFromHtml(path, read(path));
}

const browserScriptExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function normalizeProjectPath(path) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isTestSourcePath(path) {
  return normalizeProjectPath(path).startsWith('src/test/');
}

function staticModuleSpecifiers(file) {
  const sourceFile = typescript.createSourceFile(
    file.path,
    file.source,
    typescript.ScriptTarget.Latest,
    true,
    scriptKind(file.path),
  );
  const specifiers = new Set();
  const add = (value) => {
    if (typescript.isStringLiteral(value) || typescript.isNoSubstitutionTemplateLiteral(value)) {
      specifiers.add(value.text);
    }
  };
  const visit = (node) => {
    if (typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node)) {
      if (node.moduleSpecifier) add(node.moduleSpecifier);
    }
    if (
      typescript.isImportEqualsDeclaration(node)
      && typescript.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
    ) {
      add(node.moduleReference.expression);
    }
    if (typescript.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === typescript.SyntaxKind.ImportKeyword;
      const isStaticRequire = typescript.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isDynamicImport || isStaticRequire) && node.arguments[0]) add(node.arguments[0]);
    }
    if (
      typescript.isNewExpression(node)
      && typescript.isIdentifier(node.expression)
      && node.expression.text === 'URL'
      && node.arguments?.[0]
    ) {
      // Vite rewrites new URL('./worker', import.meta.url) into a worker/asset
      // entrypoint, so a test module referenced this way is browser-reachable.
      add(node.arguments[0]);
    }
    if (
      typescript.isNewExpression(node)
      && typescript.isIdentifier(node.expression)
      && ['Worker', 'SharedWorker'].includes(node.expression.text)
      && node.arguments?.[0]
    ) {
      // Static worker URLs are executable browser entrypoints even when they
      // are not wrapped in new URL(..., import.meta.url).
      add(node.arguments[0]);
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...specifiers];
}

function usesImportMetaGlob(file) {
  return /\bimport\s*\.\s*meta\s*\.\s*glob(?:Eager)?\s*\(/.test(file.source);
}

function resolveBrowserModulePath(importerPath, moduleSpecifier, knownPaths) {
  const normalizedImporter = normalizeProjectPath(importerPath);
  const rawSpecifier = moduleSpecifier.replaceAll('\\', '/').split(/[?#]/, 1)[0];
  let basePath = null;
  if (rawSpecifier.startsWith('@/')) {
    basePath = `src/${rawSpecifier.slice(2)}`;
  } else if (rawSpecifier.startsWith('./') || rawSpecifier.startsWith('../')) {
    basePath = normalizeProjectPath(join(dirname(normalizedImporter), rawSpecifier));
  } else if (rawSpecifier.startsWith('/')) {
    basePath = rawSpecifier.startsWith('/src/')
      ? rawSpecifier.slice(1)
      : `public/${rawSpecifier.slice(1)}`;
  }
  if (!basePath) return null;
  const candidates = [basePath];
  if (!browserScriptExtensions.some((extension) => basePath.endsWith(extension))) {
    for (const extension of browserScriptExtensions) candidates.push(`${basePath}${extension}`);
  }
  for (const extension of browserScriptExtensions) candidates.push(`${basePath}/index${extension}`);
  if (!basePath.startsWith('src/') && !basePath.startsWith('public/')) {
    candidates.push(`public/${basePath}`);
  }
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

function selectBrowserScriptFiles(scriptFiles) {
  const files = scriptFiles.map((file) => ({ ...file, path: normalizeProjectPath(file.path) }));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const knownPaths = new Set(byPath.keys());
  const selectedTestPaths = new Set();
  const testPaths = files.filter((file) => isTestSourcePath(file.path)).map((file) => file.path);
  const queue = files.filter((file) => !isTestSourcePath(file.path));
  const visitedPaths = new Set();
  const includeTestPath = (path) => {
    if (selectedTestPaths.has(path)) return;
    selectedTestPaths.add(path);
    queue.push(byPath.get(path));
  };
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    if (visitedPaths.has(file.path)) continue;
    visitedPaths.add(file.path);
    if (usesImportMetaGlob(file)) {
      for (const testPath of testPaths) includeTestPath(testPath);
    }
    for (const moduleSpecifier of staticModuleSpecifiers(file)) {
      const importedPath = resolveBrowserModulePath(file.path, moduleSpecifier, knownPaths);
      if (!importedPath || !isTestSourcePath(importedPath) || selectedTestPaths.has(importedPath)) continue;
      includeTestPath(importedPath);
    }
  }
  return files.filter((file) => !isTestSourcePath(file.path) || selectedTestPaths.has(file.path));
}

function browserSourceFiles() {
  const browserRoots = [sourceRoot, publicRoot].filter(existsSync);
  const htmlPaths = [
    ...(existsSync(indexHtmlPath) ? [indexHtmlPath] : []),
    ...(existsSync(publicRoot) ? htmlFiles(publicRoot) : []),
  ];
  const indexDocumentBaseHref = existsSync(indexHtmlPath)
    ? staticHtmlBaseHref(staticHtmlOpenTags(read(indexHtmlPath)))
    : null;
  const scriptFiles = browserRoots
    .flatMap((directory) => sourceFiles(directory))
    .map((path) => ({
      path: relative(root, path),
      source: read(path),
      documentBaseHref: indexDocumentBaseHref,
    }));
  const cssPaths = browserRoots.flatMap((directory) => cssFiles(directory));
  const svgPaths = browserRoots.flatMap((directory) => svgFiles(directory));
  // Test modules are not browser code by default, but become in-scope when a
  // production module statically or dynamically imports them.
  return [
    ...selectBrowserScriptFiles([
      ...scriptFiles,
      ...htmlPaths.flatMap((path) => inlineBrowserScripts(path)),
      ...svgPaths.flatMap((path) => inlineBrowserScripts(path)),
    ]),
    ...htmlPaths.flatMap((path) => staticHtmlResourceAttributes(path)),
    ...htmlPaths.flatMap((path) => staticHtmlConfigurationAttributes(path)),
    ...htmlPaths.flatMap((path) => staticHtmlTextConfigurationValues(path)),
    ...htmlPaths.flatMap((path) => staticHtmlCommentConfigurationValues(path)),
    ...htmlPaths.flatMap((path) => staticHtmlMetaRefreshes(path)),
    ...cssPaths.flatMap((path) => staticCssResourceAttributesFromCss(path, read(path), indexDocumentBaseHref)),
    ...svgPaths.flatMap((path) => staticSvgResourceAttributes(path)),
  ];
}

function tableBlock(migration, table) {
  const start = migration.indexOf(`-- ${table}`);
  assert.ok(start >= 0, `missing ${table} migration section`);
  const next = migration.indexOf('\n-- ', start + table.length + 3);
  return migration.slice(start, next >= 0 ? next : migration.length);
}

function compactSql(source) {
  return source
    .replace(/"([a-z_][a-z0-9_]*)"/g, '$1')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeSqlWhitespace(source) {
  return source.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function executableSqlStatements(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
  return withoutComments
    .split(';')
    .map((statement) => normalizeSqlWhitespace(statement))
    .filter(Boolean)
    .map((statement) => `${statement};`);
}

function expectedLockdownStatements() {
  const expected = ['BEGIN;'];
  for (const contract of tables) {
    expected.push(`ALTER TABLE public.${contract.table} ENABLE ROW LEVEL SECURITY;`);
    for (const policy of contract.legacyPolicies) {
      expected.push(`DROP POLICY IF EXISTS "${policy}" ON public.${contract.table};`);
    }
    expected.push(`REVOKE ALL ON TABLE public.${contract.table} FROM PUBLIC, anon, authenticated;`);
    expected.push(`GRANT ALL ON TABLE public.${contract.table} TO service_role;`);
    expected.push(
      `CREATE POLICY "${contract.servicePolicy}" ON public.${contract.table} FOR ALL TO service_role USING ((SELECT auth.role()) = 'service_role') WITH CHECK ((SELECT auth.role()) = 'service_role');`,
    );
  }
  expected.push('COMMIT;');
  return expected;
}

function directFunctionGrantStatements(source, signature) {
  const functionName = compactSql(signature).match(/^public\.([a-z_][a-z0-9_]*)\(/)?.[1];
  assert.ok(functionName, `protected RPC signature must name a public function: ${signature}`);
  const target = `onfunctionpublic.${functionName}(`;
  return executableSqlStatements(source)
    .filter((statement) => {
      const compact = compactSql(statement);
      return compact.startsWith('grant') && compact.includes(target);
    });
}

function functionGrantStatements(source) {
  return executableSqlStatements(source)
    .filter((statement) => /^GRANT\s+.+?\s+ON\s+FUNCTION\b/i.test(normalizeSqlWhitespace(statement)));
}

function isServiceOnlyFunctionGrant(statement) {
  return /^GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+.+?\s+TO\s+service_role;$/i.test(
    normalizeSqlWhitespace(statement),
  );
}

function hasDynamicSqlBlock(source) {
  return executableSqlStatements(source)
    .some((statement) => /^DO\b/i.test(normalizeSqlWhitespace(statement)));
}

function isSchemaWideFunctionGrant(statement) {
  return /^GRANT\s+(?:EXECUTE|ALL(?:\s+PRIVILEGES)?)\s+ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA\s+.+?\s+TO\s+/i.test(
    normalizeSqlWhitespace(statement),
  );
}

function browserSchemaFunctionGrant(source) {
  return executableSqlStatements(source).some(isSchemaWideFunctionGrant);
}

function functionDefinitions(source) {
  const definitions = [];
  const pattern = /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+(public\.[a-z_][a-z0-9_]*\s*\([^)]*\))[\s\S]*?\$\$;/gi;
  for (const match of source.matchAll(pattern)) {
    definitions.push({ signature: normalizeSqlWhitespace(match[1]), source: match[0] });
  }
  return definitions;
}

function validateFunctionPrivilegeContract(source, label) {
  const definitions = functionDefinitions(source);
  const statements = executableSqlStatements(source);
  const grants = statements.filter((statement) => /^GRANT\s+.+?\s+ON\s+FUNCTION\b/i.test(statement));
  const revokes = statements.filter((statement) => /^REVOKE\s+.+?\s+ON\s+FUNCTION\b/i.test(statement));
  assert.ok(grants.length <= definitions.length, `${label}: function grants must map one-to-one to definitions`);
  assert.equal(
    revokes.length,
    definitions.length,
    `${label}: every new function must have exactly one direct browser-role revoke`,
  );
  for (const definition of definitions) {
    const signature = compactSql(definition.signature);
    const functionName = signature.match(/^public\.([a-z_][a-z0-9_]*)\(/)?.[1];
    assert.ok(functionName, `${label}: function signature must be public-qualified`);
    const revokePrefix = `revokeallonfunctionpublic.${functionName}(`;
    const grantPrefix = `grantexec uteonfunctionpublic.${functionName}(`.replace(' ', '');
    assert.equal(
      revokes.filter((statement) => compactSql(statement).startsWith(revokePrefix)
        && compactSql(statement).endsWith('frompublic,anon,authenticated;')).length,
      1,
      `${label}: ${definition.signature} must revoke public, anon, and authenticated execution exactly`,
    );
    const matchingGrants = grants.filter((statement) => compactSql(statement).startsWith(grantPrefix));
    if (matchingGrants.length === 0) {
      assert.match(
        source,
        new RegExp(`EXECUTE\\s+FUNCTION\\s+public\\.${escapeRegExp(functionName)}\\(`, 'i'),
        `${label}: ${definition.signature} may omit a grant only as a trigger handler`,
      );
    } else {
      assert.equal(matchingGrants.length, 1, `${label}: ${definition.signature} must have one direct grant`);
      assert.match(matchingGrants[0], /^GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.[a-z_][a-z0-9_]*\([^)]*\)\s+TO\s+service_role;$/i, `${label}: ${definition.signature} must grant EXECUTE only to service_role`);
    }
    const isSecurityDefiner = /SECURITY\s+DEFINER/i.test(definition.source);
    const closedSearchPath = /SET\s+search_path\s+TO\s+public\s*,\s*pg_catalog\b/i.test(definition.source)
      || /SET\s+search_path\s*=\s*''/i.test(definition.source);
    if (isSecurityDefiner) assert.ok(closedSearchPath, `${label}: ${definition.signature} must pin an empty or public, pg_catalog search_path`);
    if (isSecurityDefiner && /SET\s+search_path\s*=\s*''/i.test(definition.source)) {
      const body = definition.source.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
      assert.doesNotMatch(
        body,
        /\b(?:FROM|JOIN|DELETE\s+FROM)\s+(?!public\.|old\b|new\b)[a-z_][a-z0-9_]*|\bUPDATE\s+(?!(?:SKIP\b|public\.|old\b|new\b))[a-z_][a-z0-9_]*/i,
        `${label}: ${definition.signature} with an empty search_path must qualify table references`,
      );
    }
  }
  assert.ok(
    grants.every((statement) => /^GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.[a-z_][a-z0-9_]*\([^)]*\)\s+TO\s+service_role;$/i.test(normalizeSqlWhitespace(statement))),
    `${label}: function grants must be direct EXECUTE grants to service_role only`,
  );
  assert.ok(
    revokes.every((statement) => /^REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.[a-z_][a-z0-9_]*\([^)]*\)\s+FROM\s+public,\s*anon,\s*authenticated;$/i.test(normalizeSqlWhitespace(statement))),
    `${label}: function revokes must directly remove public, anon, and authenticated`,
  );
}

function validateRlsTableIntent(source, label) {
  const statements = executableSqlStatements(source);
  const createdTables = statements
    .map((statement) => statement.match(/^CREATE TABLE(?: IF NOT EXISTS)?\s+public\.([a-z_][a-z0-9_]*)\b/i)?.[1])
    .filter(Boolean);
  for (const table of createdTables) {
    assert.ok(
      statements.some((statement) => new RegExp(`^ALTER TABLE public\\.${escapeRegExp(table)} ENABLE ROW LEVEL SECURITY;$`, 'i').test(statement)),
      `${label}: new table ${table} must retain RLS enabled`,
    );
    assert.ok(
      statements.some((statement) => new RegExp(`^REVOKE ALL ON (?:TABLE )?public\\.${escapeRegExp(table)} FROM public, anon, authenticated;$`, 'i').test(statement)),
      `${label}: new table ${table} must revoke browser-role table access`,
    );
  }
}

function validateB2BSuccessor(source, label) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  assert.match(
    withoutComments,
    /^DO\s+\$\$[\s\S]*?\$\$;\s*ALTER TABLE\s+public\.media_objects\s+ALTER COLUMN\s+deletion_token\s+TYPE\s+uuid\s+USING\s+deletion_token::uuid\s*;$/i,
    `${label}: B2B successor may contain only the bounded UUID guard and explicit cast`,
  );
  assert.match(withoutComments, /IF\s+EXISTS\s*\([\s\S]*deletion_token\s+IS\s+NOT\s+NULL[\s\S]*deletion_token\s+!~\s*'\^\[0-9A-Fa-f\]\{8\}-\[0-9A-Fa-f\]\{4\}-\[0-9A-Fa-f\]\{4\}-\[0-9A-Fa-f\]\{4\}-\[0-9A-Fa-f\]\{12\}\$'/i, `${label}: B2B UUID guard must reject every non-canonical token`);
  assert.match(withoutComments, /RAISE\s+EXCEPTION\s+'E6_B2B invalid deletion_token values prevent UUID conversion'/i, `${label}: B2B guard exception is missing`);
  assert.match(withoutComments, /USING\s+ERRCODE\s*=\s*'check_violation'/i, `${label}: B2B guard exception code is missing`);
}

function validateB4Migration(source, label) {
  const requiredFunctions = [
    'claim_video_renders',
    'claim_video_render_by_id',
    'renew_video_render_lease',
    'complete_video_render',
    'block_video_render',
    'fail_video_render',
  ];
  const definitions = functionDefinitions(source);
  for (const name of ['claim_video_renders', 'claim_video_render_by_id']) {
    const definition = definitions.find(({ signature }) => signature.startsWith(`public.${name}(`));
    assert.ok(definition, `${label}: ${name} definition is missing`);
    assert.equal((definition.source.match(/claim_token\s*=\s*gen_random_uuid\(\)/g) ?? []).length, 1, `${label}: ${name} must rotate claim token`);
    assert.match(definition.source, /claim_generation\s*=\s*COALESCE\(vr\.claim_generation,\s*0\)\s*\+\s*1/i, `${label}: ${name} must rotate claim generation`);
  }
  const renewal = definitions.find(({ signature }) => signature.startsWith('public.renew_video_render_lease('));
  assert.ok(renewal, `${label}: lease renewal definition is missing`);
  for (const fence of ["status = 'running'", 'locked_by = p_worker_id', 'claim_token = p_claim_token', 'claim_generation = p_claim_generation', 'lease_expires_at >= now()']) {
    assert.match(renewal.source, new RegExp(`AND\\s+${escapeRegExp(fence)}`, 'i'), `${label}: renewal must enforce ${fence}`);
  }
  for (const name of ['complete_video_render', 'block_video_render', 'fail_video_render']) {
    const definition = definitions.find(({ signature }) => signature.startsWith(`public.${name}(`));
    assert.ok(definition, `${label}: ${name} definition is missing`);
    for (const fence of ["status = 'running'", 'locked_by = p_worker_id', 'claim_token = p_claim_token', 'claim_generation = p_claim_generation']) {
      assert.match(definition.source, new RegExp(`AND\\s+${escapeRegExp(fence)}`, 'i'), `${label}: ${name} must enforce ${fence}`);
    }
    assert.match(definition.source, /'accepted',\s*false[\s\S]*'stale_video_render_claim'/i, `${label}: ${name} must reject stale claims`);
  }
  assert.equal(requiredFunctions.length, definitions.length, `${label}: B4 must define exactly the six reviewed renderer functions`);
}

function validateE7DefaultPrivilegesMigration(source, label) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .trim();
  assert.match(
    withoutComments,
    /^BEGIN;[\s\S]*COMMIT;$/i,
    `${label}: E7 default-privilege cleanup must be transactional`,
  );
  assert.equal(
    (withoutComments.match(/\bDO\s+\$\$/gi) ?? []).length,
    2,
    `${label}: E7 must have one owner cleanup block and one terminal catalog assertion`,
  );
  assert.equal(
    (withoutComments.match(/\bEXECUTE\s+format\s*\(/gi) ?? []).length,
    3,
    `${label}: E7 must execute exactly the three static owner-qualified revokes`,
  );
  assert.doesNotMatch(
    withoutComments,
    /\b(?:alter|create)\s+role\b|\bset\s+(?:local\s+)?role\b|EXCEPTION\s+WHEN\s+(?:insufficient_privilege|others)\b/i,
    `${label}: E7 must not change roles, change execution role, or hide authority errors`,
  );
  assert.match(
    withoutComments,
    /IF\s+pg_has_role\(current_user,\s*owner_name,\s*'USAGE'\)\s+THEN/i,
    `${label}: controllable owners must be identified from current-role membership`,
  );
  assert.match(
    withoutComments,
    /ELSIF\s+owner_name\s*=\s*'supabase_admin'\s+THEN/i,
    `${label}: only supabase_admin may use the provider-managed exception`,
  );
  assert.match(
    withoutComments,
    /RAISE\s+NOTICE\s+'E7 provider-managed default ACL owner skipped: %'/i,
    `${label}: provider-managed exception must be visible`,
  );
  assert.match(
    withoutComments,
    /RAISE\s+EXCEPTION\s+'E7 cannot control browser default ACL owner: %'/i,
    `${label}: arbitrary non-controllable owners must fail closed`,
  );
  assert.match(
    withoutComments,
    /USING\s+ERRCODE\s*=\s*'insufficient_privilege'/i,
    `${label}: uncontrollable-owner failure must preserve an authorization error`,
  );

  assert.match(withoutComments, /FOR\s+owner_name\s+IN[\s\S]*FROM\s+pg_default_acl\s+AS\s+defaults/i, `${label}: owner discovery must start from pg_default_acl`);
  assert.match(withoutComments, /JOIN\s+pg_roles\s+AS\s+owner_role[\s\S]*owner_role\.oid\s*=\s*defaults\.defaclrole/i, `${label}: owner discovery must resolve pg_roles`);
  assert.match(withoutComments, /JOIN\s+pg_namespace\s+AS\s+target_schema[\s\S]*target_schema\.oid\s*=\s*defaults\.defaclnamespace/i, `${label}: owner discovery must resolve the target schema`);
  assert.match(withoutComments, /CROSS\s+JOIN\s+LATERAL\s+aclexplode\(defaults\.defaclacl\)/i, `${label}: owner discovery must inspect default ACL entries`);
  assert.equal((withoutComments.match(/target_schema\.nspname\s*=\s*'public'/gi) ?? []).length, 3, `${label}: discovery, count assertion, and diagnostics must be scoped to public`);
  assert.match(withoutComments, /defaults\.defaclobjtype\s+IN\s*\('r',\s*'S',\s*'f'\)/i, `${label}: owner discovery must cover tables, sequences, and functions`);
  assert.match(withoutComments, /acl\.grantee\s*=\s*0[\s\S]*grantee_role\.rolname\s+IN\s*\('anon',\s*'authenticated'\)/i, `${label}: owner discovery must cover PUBLIC, anon, and authenticated`);
  assert.match(withoutComments, /owner_name\s*\)/i, `${label}: each dynamic statement must use the discovered owner`);

  for (const statement of [
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;',
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;',
  ]) {
    assert.equal(
      (withoutComments.match(new RegExp(escapeRegExp(statement), 'g')) ?? []).length,
      1,
      `${label}: missing or duplicated static revoke body ${statement}`,
    );
  }
  assert.doesNotMatch(withoutComments, /REVOKE[\s\S]*?FROM[^;]*\bservice_role\b/i, `${label}: service_role defaults remain explicitly deferred`);
  assert.match(withoutComments, /unsupported_owner_count\s*<>\s*0[\s\S]*RAISE\s+EXCEPTION\s+'E7 unsupported browser default privilege owner remains/i, `${label}: terminal assertion must reject arbitrary residual owners`);
  assert.match(withoutComments, /controllable_count\s*<>\s*0[\s\S]*RAISE\s+EXCEPTION\s+'E7 browser default privileges remain for controllable owners/i, `${label}: terminal assertion must reject controllable residual defaults`);
  assert.match(withoutComments, /pg_has_role\(current_user,\s*owner_role\.rolname,\s*'USAGE'\)/i, `${label}: terminal assertion must classify controllable residual owners`);
  assert.match(withoutComments, /owner_role\.rolname\s*<>\s*'supabase_admin'/i, `${label}: terminal assertion must allow only the exact provider-managed residual owner`);
  assert.match(withoutComments, /FROM\s+pg_default_acl\s+AS\s+defaults[\s\S]*aclexplode\(defaults\.defaclacl\)/i, `${label}: terminal catalog assertion must inspect pg_default_acl`);
  const diagnosticAggregates = sqlFunctionCallBodies(withoutComments, 'string_agg');
  assert.ok(diagnosticAggregates.length > 0, `${label}: residual diagnostics must use string_agg`);
  for (const [index, aggregateBody] of diagnosticAggregates.entries()) {
    assert.match(
      aggregateBody,
      /\bORDER\s+BY\s+owner_id,\s*objtype,\s*grantee_name,\s*privilege_type,\s*is_grantable\b/i,
      `${label}: diagnostic string_agg occurrence ${index + 1} must use aggregate-level deterministic ordering`,
    );
  }
  assert.match(
    withoutComments,
    /SELECT\s+string_agg[\s\S]*FROM\s*\(\s*SELECT[\s\S]*\bLIMIT\s+20\s*\)\s+AS\s+offending/i,
    `${label}: residual diagnostics must bound rows before string_agg`,
  );
  assert.match(
    withoutComments,
    /\bleft\s*\(\s*COALESCE\s*\(\s*offending_details\s*,\s*'<none>'\s*\)\s*,\s*2000\s*\)/i,
    `${label}: residual diagnostic output must be capped`,
  );
}

function validatePostLockdownMigrations(postLockdownMigrations) {
  const names = [...postLockdownMigrations.keys()].sort();
  assert.deepEqual(names, [...postLockdownMigrationDigests.keys()].sort(), 'post-lockdown migration set must remain exact');
  for (const [name, source] of postLockdownMigrations) {
    assert.equal(typeof source, 'string', `${name} source must be loaded as text`);
    const normalized = normalizedMigrationAccessSource(source);
    if (name === e7MigrationName) {
      validateE7DefaultPrivilegesMigration(source, name);
      assert.equal(
        createHash('sha256').update(source).digest('hex'),
        postLockdownMigrationDigests.get(name),
        `${name}: exact migration SHA drifted`,
      );
      continue;
    }
    assert.doesNotMatch(normalized, /\b(?:alter|create)\s+role\b|\balter\s+default\s+privileges\b|\bset\s+(?:local\s+)?role\b/i, `${name}: role/default-privilege mutations are forbidden`);
    assert.doesNotMatch(normalized, /\bgrant\s+(?:execute|all(?:\s+privileges)?)\s+on\s+all\s+(?:tables|functions)\s+in\s+schema\b/i, `${name}: schema-wide grants are forbidden`);
    assert.doesNotMatch(normalized, /\bgrant\s+[^;]*\bto\s+(?:public|anon|authenticated)\b/i, `${name}: browser grants are forbidden`);
    if (name === '20260808133000_b2b_media_object_deletion_token_uuid.sql') {
      validateB2BSuccessor(source, name);
    } else {
      assert.doesNotMatch(normalized, /(?:^|\n)\s*do\s+\$\$|\bexecute\s+(?:format\s*\(|['$])/i, `${name}: dynamic SQL is forbidden`);
      validateFunctionPrivilegeContract(source, name);
      validateRlsTableIntent(source, name);
      if (name === '20260808123000_b4_video_render_claim_fencing.sql') validateB4Migration(source, name);
    }
    assert.equal(
      createHash('sha256').update(source).digest('hex'),
      postLockdownMigrationDigests.get(name),
      `${name}: exact migration SHA drifted`,
    );
  }
}

function scriptKind(path) {
  if (/\.(?:[cm]?jsx?|tsx)$/i.test(path)) return typescript.ScriptKind.JSX;
  if (/\.(?:[cm]?js)$/i.test(path)) return typescript.ScriptKind.JS;
  return typescript.ScriptKind.TS;
}

function isSatisfiesExpression(node) {
  return (
    (typeof typescript.isSatisfiesExpression === 'function' && typescript.isSatisfiesExpression(node))
    || node.kind === typescript.SyntaxKind.SatisfiesExpression
  );
}

function unwrapExpression(node) {
  let current = node;
  while (
    typescript.isAsExpression(current)
    || typescript.isTypeAssertionExpression(current)
    || typescript.isParenthesizedExpression(current)
    || typescript.isNonNullExpression(current)
    || isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function exportedStringArray(source, path, exportName) {
  const sourceFile = typescript.createSourceFile(
    path,
    source,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  let values = null;
  const visit = (node) => {
    if (
      typescript.isVariableDeclaration(node)
      && typescript.isIdentifier(node.name)
      && node.name.text === exportName
      && node.initializer
    ) {
      const initializer = unwrapExpression(node.initializer);
      if (typescript.isArrayLiteralExpression(initializer)) {
        const entries = initializer.elements.map((element) => (
          typescript.isStringLiteral(element) || typescript.isNoSubstitutionTemplateLiteral(element)
            ? element.text
            : null
        ));
        if (entries.every((entry) => entry !== null)) values = entries;
      }
    }
    typescript.forEachChild(node, visit);
  };
  visit(sourceFile);
  assert.ok(values !== null, `${path} must export ${exportName} as a static string array`);
  return values;
}

const sourceFileIssueCache = new WeakMap();

function sourceFileIssues(frontendFiles) {
  const issues = [];
  const protectedTables = new Set(tables.map(({ table }) => table));
  const browserTransportModules = new Set([
    'axios',
    'cross-fetch',
    'got',
    'ky',
    'node-fetch',
    'superagent',
  ]);
  const directTransportConstructors = new Set(['EventSource', 'WebSocket', 'XMLHttpRequest']);
  const workerConstructors = new Set(['Worker', 'SharedWorker']);
  const dynamicCodeIdentifiers = new Set(['eval', 'Function']);
  // The client has no reviewed binary-to-string route construction. Keeping
  // these primitives out of browser source closes opaque UTF-8/code-unit
  // route assembly without weakening the server-side RLS enforcement layer.
  const unreviewedBinaryRoutePrimitiveNames = new Set([
    'ArrayBuffer',
    'DataView',
    'Int8Array',
    'Int16Array',
    'Int32Array',
    'TextDecoder',
    'TextDecoderStream',
    'Uint8Array',
    'Uint16Array',
    'Uint32Array',
  ]);
  const dynamicCodeEscapeProperties = new Set(['__proto__', 'constructor', 'prototype']);
  // `navigator` is a separate global transport host because sendBeacon must
  // retain that receiver even when its member name is computed.
  const browserGlobalRoots = new Set([
    'window',
    'globalThis',
    'self',
    'document',
    'navigator',
    'clientInformation',
    'top',
    'parent',
    'opener',
    'frames',
  ]);
  // These properties resolve to a Window/WindowProxy, navigator, or Document
  // surface. Treat them as guarded browser surfaces too, so a native
  // constructor, beacon, or computed defaultView cannot be recovered through
  // a same-origin frame or parent window.
  const browserWindowHostProperties = new Set([
    'window',
    'self',
    'top',
    'parent',
    'opener',
    'frames',
    'navigator',
    'clientInformation',
    'document',
  ]);
  const browserWindowProxyProperties = new Set(['contentWindow', 'view']);
  const browserDocumentProperties = new Set(['contentDocument', 'ownerDocument']);
  // Browser source has no approved reason to traverse from a DOM node back to
  // a WindowProxy. Ban both the Document property and its root-node escape
  // hatch so an alias cannot hide the eventual transport host.
  const browserWindowProxyEscapeProperties = new Set(['defaultView', 'getRootNode']);
  // Event APIs can expose their dispatch Window through these legacy or path
  // properties. There is no reviewed browser need for them in this client.
  const browserEventTransportEscapeProperties = new Set([
    'composedPath',
    'path',
    'relatedTarget',
    'srcElement',
  ]);
  const browserEventRegistrationMethods = new Set(['addEventListener', 'removeEventListener']);
  const isBrowserTransportModule = (moduleName) => (
    [...browserTransportModules].some((name) => moduleName === name || moduleName.startsWith(`${name}/`))
  );
  const stringValue = (node) => (
    node && (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node))
      ? node.text
      : null
  );
  const unwrapParentExpression = (node) => {
    let current = node;
    while (
      current.parent
      && (
        (typescript.isAsExpression(current.parent) && current.parent.expression === current)
        || (typescript.isTypeAssertionExpression(current.parent) && current.parent.expression === current)
        || (typescript.isParenthesizedExpression(current.parent) && current.parent.expression === current)
        || (typescript.isNonNullExpression(current.parent) && current.parent.expression === current)
        || (isSatisfiesExpression(current.parent) && current.parent.expression === current)
      )
    ) {
      current = current.parent;
    }
    return current;
  };
  const isCurrentTargetExpression = (node) => (
    typescript.isPropertyAccessExpression(node) && node.name.text === 'currentTarget'
  ) || (
    typescript.isElementAccessExpression(node)
    && stringValue(node.argumentExpression) === 'currentTarget'
  );
  const isEventTargetExpression = (node) => (
    typescript.isPropertyAccessExpression(node) && node.name.text === 'target'
  ) || (
    typescript.isElementAccessExpression(node)
    && stringValue(node.argumentExpression) === 'target'
  );
  const eventValueNames = new Set(['event', 'e', 'message', 'messageEvent']);
  const isMessageEventSourceExpression = (
    node,
    isMessageEventParameterReference = () => false,
    isGlobalMessageEventReference = () => false,
  ) => {
    const isEventValue = (value) => (
      (
        typescript.isIdentifier(unwrapExpression(value))
        && eventValueNames.has(unwrapExpression(value).text)
      ) || isMessageEventParameterReference(value) || isGlobalMessageEventReference(value)
    );
    return (
      typescript.isPropertyAccessExpression(node)
      && node.name.text === 'source'
      && isEventValue(node.expression)
    ) || (
      typescript.isElementAccessExpression(node)
      && stringValue(node.argumentExpression) === 'source'
      && isEventValue(node.expression)
    );
  };
  const isReviewedCurrentTargetUse = (node, file) => {
    const outer = unwrapParentExpression(node);
    const parent = outer.parent;
    return (
      typescript.isNewExpression(parent)
      && typescript.isIdentifier(parent.expression)
      && parent.expression.text === 'FormData'
      && parent.arguments?.includes(outer)
    ) || (
      typescript.isPropertyAccessExpression(parent)
      && parent.expression === outer
      && parent.name.text === 'scrollTop'
    ) || (
      file.path === 'src/pages/Dashboard.tsx'
      && typescript.isPropertyAccessExpression(parent)
      && parent.expression === outer
      && parent.name.text === 'open'
    );
  };
  const reviewedEventTargetProperties = new Set(['value', 'checked', 'name']);
  const isReviewedEventTargetUse = (node) => {
    const outer = unwrapParentExpression(node);
    const parent = outer.parent;
    return (
      typescript.isPropertyAccessExpression(parent)
      && parent.expression === outer
      && reviewedEventTargetProperties.has(parent.name.text)
    ) || (
      typescript.isElementAccessExpression(parent)
      && parent.expression === outer
      && reviewedEventTargetProperties.has(stringValue(parent.argumentExpression) ?? '')
    );
  };
  const propertyName = (node) => {
    if (typescript.isIdentifier(node.name) || typescript.isStringLiteral(node.name)) return node.name.text;
    return null;
  };
  const callTarget = (node, sourceFile) => {
    if (typescript.isPropertyAccessExpression(node.expression)) {
      return {
        method: node.expression.name.text,
        receiver: node.expression.expression.getText(sourceFile),
      };
    }
    if (typescript.isElementAccessExpression(node.expression)) {
      return {
        method: stringValue(node.expression.argumentExpression),
        receiver: node.expression.expression.getText(sourceFile),
      };
    }
    return { method: null, receiver: null };
  };
  const isCanonicalMonitoringRealtimeTable = (file, node) => {
    if (!typescript.isIdentifier(node)) return false;
    let cursor = node.parent;
    while (cursor && !typescript.isArrowFunction(cursor)) cursor = cursor.parent;
    if (cursor && cursor.parameters.length === 1) {
      const parameter = cursor.parameters[0]?.name;
      const parent = cursor.parent;
      if (
        typescript.isIdentifier(parameter)
        && parameter.text === node.text
        && typescript.isCallExpression(parent)
        && typescript.isPropertyAccessExpression(parent.expression)
        && parent.expression.name.text === 'forEach'
        && typescript.isIdentifier(parent.expression.expression)
        && parent.expression.expression.text === 'MONITORING_REALTIME_TABLES'
        && file.path === 'src/hooks/useMonitoringData.ts'
      ) return true;
    }

    if (file.path !== 'src/hooks/useDashboardProcessHudData.ts') return false;
    cursor = node.parent;
    while (cursor && !typescript.isForOfStatement(cursor)) cursor = cursor.parent;
    if (!cursor || !typescript.isVariableDeclarationList(cursor.initializer)) return false;
    const declaration = cursor.initializer.declarations[0];
    if (!declaration || !typescript.isIdentifier(declaration.name) || declaration.name.text !== node.text) return false;
    if (!typescript.isArrayLiteralExpression(cursor.expression)) return false;
    return cursor.expression.elements.map(stringValue).join('|') ===
      'posts|jobs|deliveries|x_deliveries|workflow_runs|ai_call_ledger';
  };
  const importsRuntimeSupabaseFactory = (statement) => {
    const importClause = statement.importClause;
    if (!importClause || importClause.isTypeOnly) return false;
    if (importClause.name) return true;
    const bindings = importClause.namedBindings;
    if (!bindings) return false;
    if (typescript.isNamespaceImport(bindings)) return true;
    return bindings.elements.some((element) => {
      const importedName = element.propertyName?.text ?? element.name.text;
      return !element.isTypeOnly && importedName === 'createClient';
    });
  };

  for (const file of frontendFiles) {
    const cached = sourceFileIssueCache.get(file);
    if (
      cached
      && cached.path === file.path
      && cached.source === file.source
      && cached.documentBaseHref === file.documentBaseHref
      && cached.staticHtmlConfigurationValue === file.staticHtmlConfigurationValue
      && cached.staticHtmlResolvedResourceUrl === file.staticHtmlResolvedResourceUrl
      && cached.staticHtmlResourceUrl === file.staticHtmlResourceUrl
    ) {
      issues.push(...cached.issues);
      continue;
    }
    const issueStart = issues.length;
    if (file.source.includes('/rest/v1/')) {
      issues.push(`${file.path}: browser source may not call a raw PostgREST /rest/v1/ endpoint`);
    }
    const hasReviewedDashboardIdentityLink = file.path === 'src/components/settings/XAutomationSettings.tsx'
      && /getSupabaseDashboardUrl\s*=|function\s+getSupabaseDashboardUrl/.test(file.source)
      && /SUPABASE_PROJECT_REF_RE/.test(file.source)
      && /SUPABASE_HOST_RE/.test(file.source);
    if (
      /\.(?:[cm]?jsx?|tsx)$/i.test(file.path)
      && file.path !== 'src/integrations/supabase/client.ts'
      && !hasReviewedDashboardIdentityLink
      && (
        /\bVITE_SUPABASE_(?:URL|PUBLISHABLE_KEY)\b/.test(file.source)
        || /https?:\/\/[^\s"'`<>]*\.supabase\.co\b/i.test(file.source)
      )
    ) {
      // Browser code must use the reviewed Supabase client, never reconstruct
      // the project base URL. This makes raw-route construction fail closed
      // regardless of the string codec used for its path.
      issues.push(`${file.path}: browser source may not reference a Supabase project base outside the reviewed client module`);
    }
    const staticHtmlResourceUrls = [
      file.staticHtmlResourceUrl,
      file.staticHtmlResolvedResourceUrl,
    ].filter((value) => typeof value === 'string');
    if (staticHtmlResourceUrls.some((value) => /(?:^|\/)rest\/v1(?:[/?#]|$)/i.test(value.replace(/\s+/g, '')))) {
      issues.push(`${file.path}: static HTML resource attribute may not load a raw PostgREST endpoint`);
    }
    if (
      file.staticHtmlConfigurationValue
      && staticHtmlResourceUrls.some((value) => /https?:\/\/[^\s"'`<>]*\.supabase\.co\b/i.test(value))
    ) {
      issues.push(`${file.path}: static HTML configuration may not retain a Supabase project base`);
    }
    const sourceFile = typescript.createSourceFile(
      file.path,
      file.source,
      typescript.ScriptTarget.Latest,
      true,
      scriptKind(file.path),
    );
    const supabaseNames = new Set(['supabase']);
    const runtimeImportBindings = new Map();
    for (const statement of sourceFile.statements) {
      if (!typescript.isImportDeclaration(statement) || !typescript.isStringLiteral(statement.moduleSpecifier)) continue;
      const moduleName = statement.moduleSpecifier.text;
      const importClause = statement.importClause;
      if (importClause && !importClause.isTypeOnly) {
        if (importClause.name) runtimeImportBindings.set(importClause.name.text, moduleName);
        const bindings = importClause.namedBindings;
        if (bindings && typescript.isNamespaceImport(bindings)) {
          runtimeImportBindings.set(bindings.name.text, moduleName);
        }
        if (bindings && typescript.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if (!element.isTypeOnly) runtimeImportBindings.set(element.name.text, moduleName);
          }
        }
      }
      if (/^(?:data|blob|https?):/i.test(moduleName)) {
        issues.push(`${file.path}: browser source may not load opaque or remote executable code`);
      }
      if (isBrowserTransportModule(moduleName)) {
        issues.push(`${file.path}: browser source may not import a direct HTTP transport`);
      }
      if (!moduleName.endsWith('/integrations/supabase/client')) continue;
      if (!importClause) continue;
      if (importClause.name) supabaseNames.add(importClause.name.text);
      const bindings = importClause.namedBindings;
      if (bindings && typescript.isNamespaceImport(bindings)) {
        issues.push(`${file.path}: browser source may not namespace-import the Supabase singleton`);
      }
      if (bindings && typescript.isNamedImports(bindings)) {
        for (const imported of bindings.elements) {
          const importedName = imported.propertyName?.text ?? imported.name.text;
          if (importedName === 'supabase') supabaseNames.add(imported.name.text);
        }
      }
    }
    for (const statement of sourceFile.statements) {
      if (
        typescript.isExportDeclaration(statement)
        && statement.moduleSpecifier
        && typescript.isStringLiteral(statement.moduleSpecifier)
        && /^(?:data|blob|https?):/i.test(statement.moduleSpecifier.text)
      ) {
        issues.push(`${file.path}: browser source may not load opaque or remote executable code`);
      }
    }
    const isSupabaseRoot = (node) => {
      const candidate = unwrapExpression(node);
      return typescript.isIdentifier(candidate) && supabaseNames.has(candidate.text);
    };
    const isDirectSupabaseDispatch = (node) => (
      (typescript.isPropertyAccessExpression(node.expression) || typescript.isElementAccessExpression(node.expression))
      && isSupabaseRoot(node.expression.expression)
    );
    const isAllowedSupabaseIdentifier = (node) => {
      if (
        typescript.isImportSpecifier(node.parent)
        || typescript.isImportClause(node.parent)
        || typescript.isNamespaceImport(node.parent)
      ) return true;
      if (
        file.path === 'src/integrations/supabase/client.ts'
        && typescript.isVariableDeclaration(node.parent)
        && node.parent.name === node
      ) return true;
      let expression = node;
      while (
        expression.parent
        && (
          typescript.isAsExpression(expression.parent)
          || typescript.isTypeAssertionExpression(expression.parent)
          || typescript.isParenthesizedExpression(expression.parent)
          || typescript.isNonNullExpression(expression.parent)
        )
        && expression.parent.expression === expression
      ) {
        expression = expression.parent;
      }
      return (
        (typescript.isPropertyAccessExpression(expression.parent) || typescript.isElementAccessExpression(expression.parent))
        && expression.parent.expression === expression
      );
    };
  // A direct transport can be recovered from any same-origin WindowProxy
  // (for example a popup, parent, or frame). No browser source has an
  // approved reason to reference these native transport member names.
  const isDirectFetch = (node) => (
    typescript.isIdentifier(node) && node.text === 'fetch'
  ) || (
    typescript.isPropertyAccessExpression(node)
    && node.name.text === 'fetch'
  );
  const isBrowserGlobalRoot = (node) => (
    typescript.isIdentifier(unwrapExpression(node))
    && browserGlobalRoots.has(unwrapExpression(node).text)
  );
  const reviewedBrowserSurfaceProperties = new Set([
    'addEventListener',
    'clearTimeout',
    'clipboard',
    'cookie',
    'getElementById',
    'history',
    'innerWidth',
    'localStorage',
    'location',
    'matchMedia',
    'removeEventListener',
    'setTimeout',
    'visibilityState',
  ]);
  const isUnreviewedBrowserSurfaceProperty = (node) => (
    typescript.isPropertyAccessExpression(node)
    && isBrowserGlobalRoot(node.expression)
    && !reviewedBrowserSurfaceProperties.has(node.name.text)
  ) || (
    typescript.isElementAccessExpression(node)
    && isBrowserGlobalRoot(node.expression)
    && !reviewedBrowserSurfaceProperties.has(stringValue(node.argumentExpression) ?? '')
  );
  const isBrowserGlobalExpression = (node) => {
    const candidate = unwrapExpression(node);
    if (isBrowserGlobalRoot(candidate)) return true;
    // The browser-side guard has no approved use for forwarding `this` into a
    // transport path; ordinary function listeners can receive Window as `this`.
    if (candidate.kind === typescript.SyntaxKind.ThisKeyword) return true;
    if (typescript.isAwaitExpression(candidate) || typescript.isYieldExpression(candidate)) {
      return candidate.expression ? isBrowserGlobalExpression(candidate.expression) : false;
    }
    const isDocumentExpression = (value) => {
      const documentCandidate = unwrapExpression(value);
      return (
        typescript.isIdentifier(documentCandidate)
        && documentCandidate.text === 'document'
      ) || (
        typescript.isPropertyAccessExpression(documentCandidate)
        && documentCandidate.name.text === 'document'
        && isBrowserGlobalExpression(documentCandidate.expression)
      ) || (
        typescript.isPropertyAccessExpression(documentCandidate)
        && browserDocumentProperties.has(documentCandidate.name.text)
      ) || (
        typescript.isElementAccessExpression(documentCandidate)
        && browserDocumentProperties.has(stringValue(documentCandidate.argumentExpression) ?? '')
      ) || (
        typescript.isCallExpression(documentCandidate)
        && (
          (typescript.isPropertyAccessExpression(unwrapExpression(documentCandidate.expression))
            && unwrapExpression(documentCandidate.expression).name.text === 'getRootNode')
          || (typescript.isElementAccessExpression(unwrapExpression(documentCandidate.expression))
            && stringValue(unwrapExpression(documentCandidate.expression).argumentExpression) === 'getRootNode')
        )
      );
    };
    if (
      typescript.isPropertyAccessExpression(candidate)
      && browserWindowProxyProperties.has(candidate.name.text)
    ) {
      return true;
    }
    if (
      typescript.isElementAccessExpression(candidate)
      && stringValue(candidate.argumentExpression) === 'contentWindow'
    ) {
      return true;
    }
    if (
      typescript.isPropertyAccessExpression(candidate)
      && browserWindowHostProperties.has(candidate.name.text)
      && isBrowserGlobalExpression(candidate.expression)
    ) {
      return true;
    }
    if (
      typescript.isElementAccessExpression(candidate)
      && isBrowserGlobalExpression(candidate.expression)
    ) {
      return true;
    }
    if (typescript.isCallExpression(candidate)) {
      const callee = unwrapExpression(candidate.expression);
      if (
        (typescript.isIdentifier(callee) && callee.text === 'open') || (
          typescript.isPropertyAccessExpression(callee)
          && callee.name.text === 'open'
          && isBrowserGlobalExpression(callee.expression)
        ) || (
          typescript.isElementAccessExpression(callee)
          && stringValue(callee.argumentExpression) === 'open'
          && isBrowserGlobalExpression(callee.expression)
        )
      ) {
        return true;
      }
      if (
        typescript.isPropertyAccessExpression(callee)
        && callee.name.text === 'valueOf'
        && isBrowserGlobalExpression(callee.expression)
      ) {
        return true;
      }
    }
    if (
      typescript.isPropertyAccessExpression(candidate)
      && candidate.name.text === 'defaultView'
      && isDocumentExpression(candidate.expression)
    ) {
      return true;
    }
    if (
      typescript.isBinaryExpression(candidate)
      && candidate.operatorToken.kind === typescript.SyntaxKind.CommaToken
    ) {
      return isBrowserGlobalExpression(candidate.right);
    }
    if (
      typescript.isBinaryExpression(candidate)
      && [
        typescript.SyntaxKind.BarBarToken,
        typescript.SyntaxKind.AmpersandAmpersandToken,
        typescript.SyntaxKind.QuestionQuestionToken,
      ].includes(candidate.operatorToken.kind)
    ) {
      return isBrowserGlobalExpression(candidate.left) || isBrowserGlobalExpression(candidate.right);
    }
    if (typescript.isConditionalExpression(candidate)) {
      return isBrowserGlobalExpression(candidate.whenTrue) || isBrowserGlobalExpression(candidate.whenFalse);
    }
    return false;
  };
  const locationNavigationProperties = new Set(['assign', 'href', 'replace']);
  const isLocationExpression = (node) => {
    const candidate = unwrapExpression(node);
    return (
      typescript.isIdentifier(candidate) && candidate.text === 'location'
    ) || (
      typescript.isPropertyAccessExpression(candidate)
      && candidate.name.text === 'location'
      && isBrowserGlobalExpression(candidate.expression)
    ) || (
      typescript.isElementAccessExpression(candidate)
      && stringValue(candidate.argumentExpression) === 'location'
      && isBrowserGlobalExpression(candidate.expression)
    );
  };
  const isLocationNavigationMember = (node) => (
    typescript.isPropertyAccessExpression(node)
    && locationNavigationProperties.has(node.name.text)
    && isLocationExpression(node.expression)
  ) || (
    typescript.isElementAccessExpression(node)
    && locationNavigationProperties.has(stringValue(node.argumentExpression) ?? '')
    && isLocationExpression(node.expression)
  );
  const isLocationNavigationAssignment = (node) => (
    typescript.isBinaryExpression(node)
    && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
    && (
      isLocationExpression(node.left)
      || isLocationNavigationMember(unwrapExpression(node.left))
    )
  );
  const isGlobalOpenMember = (node) => (
    typescript.isPropertyAccessExpression(node)
    && node.name.text === 'open'
    && isBrowserGlobalExpression(node.expression)
  ) || (
    typescript.isElementAccessExpression(node)
    && stringValue(node.argumentExpression) === 'open'
    && isBrowserGlobalExpression(node.expression)
  );
  const isGlobalOpenCall = (node) => (
    typescript.isCallExpression(node)
    && isGlobalOpenMember(unwrapExpression(node.expression))
  );
  const containsBrowserGlobalHost = (node) => {
    const candidate = unwrapExpression(node);
    if (isBrowserGlobalExpression(candidate)) return true;
    if (typescript.isSpreadElement(candidate)) {
      return containsBrowserGlobalHost(candidate.expression);
    }
    if (typescript.isArrayLiteralExpression(candidate)) {
      return candidate.elements.some((element) => containsBrowserGlobalHost(element));
    }
    if (typescript.isObjectLiteralExpression(candidate)) {
      return candidate.properties.some((property) => {
        if (typescript.isSpreadAssignment(property)) return containsBrowserGlobalHost(property.expression);
        if (typescript.isPropertyAssignment(property)) return containsBrowserGlobalHost(property.initializer);
        if (typescript.isShorthandPropertyAssignment(property)) return isBrowserGlobalExpression(property.name);
        return false;
      });
    }
    return false;
  };
  const isFunctionLike = (node) => (
    typescript.isArrowFunction(node)
    || typescript.isFunctionExpression(node)
    || typescript.isFunctionDeclaration(node)
    || typescript.isMethodDeclaration(node)
  );
  const isGlobalEventListenerCall = (node) => {
    if (!typescript.isCallExpression(node)) return false;
    const callee = unwrapExpression(node.expression);
    return (
      typescript.isIdentifier(callee) && callee.text === 'addEventListener'
    ) || (
      typescript.isPropertyAccessExpression(callee)
      && callee.name.text === 'addEventListener'
      && isBrowserGlobalExpression(callee.expression)
    ) || (
      typescript.isElementAccessExpression(callee)
      && stringValue(callee.argumentExpression) === 'addEventListener'
      && isBrowserGlobalExpression(callee.expression)
    );
  };
  const isGlobalMessageListenerCall = (node) => (
    isGlobalEventListenerCall(node) && stringValue(node.arguments[0]) === 'message'
  );
  const isGlobalMessageHandlerAssignment = (node) => {
    if (
      !typescript.isBinaryExpression(node)
      || node.operatorToken.kind !== typescript.SyntaxKind.EqualsToken
    ) return false;
    const target = unwrapExpression(node.left);
    return (
      typescript.isIdentifier(target) && target.text === 'onmessage'
    ) || (
      typescript.isPropertyAccessExpression(target)
      && target.name.text === 'onmessage'
      && isBrowserGlobalExpression(target.expression)
    ) || (
      typescript.isElementAccessExpression(target)
      && stringValue(target.argumentExpression) === 'onmessage'
      && isBrowserGlobalExpression(target.expression)
    );
  };
  const namedMessageHandlers = new Set();
  const collectMessageHandlers = (node) => {
    if (isGlobalMessageListenerCall(node) && typescript.isIdentifier(node.arguments[1])) {
      namedMessageHandlers.add(node.arguments[1].text);
    }
    if (isGlobalMessageHandlerAssignment(node) && typescript.isIdentifier(node.right)) {
      namedMessageHandlers.add(node.right.text);
    }
    typescript.forEachChild(node, collectMessageHandlers);
  };
  collectMessageHandlers(sourceFile);
  const isMessageListenerObject = (node) => {
    const outer = unwrapParentExpression(node);
    const parent = outer.parent;
    return (
      typescript.isObjectLiteralExpression(outer)
      && isGlobalMessageListenerCall(parent)
      && parent.arguments[1] === outer
    ) || (
      typescript.isObjectLiteralExpression(outer)
      && typescript.isVariableDeclaration(parent)
      && parent.initializer === outer
      && typescript.isIdentifier(parent.name)
      && namedMessageHandlers.has(parent.name.text)
    );
  };
  const isMessageListenerObjectMember = (node) => {
    const outer = unwrapParentExpression(node);
    if (
      typescript.isMethodDeclaration(outer)
      && propertyName(outer) === 'handleEvent'
      && typescript.isObjectLiteralExpression(outer.parent)
    ) {
      return isMessageListenerObject(outer.parent);
    }
    if (
      (typescript.isArrowFunction(outer) || typescript.isFunctionExpression(outer))
      && typescript.isPropertyAssignment(outer.parent)
      && propertyName(outer.parent) === 'handleEvent'
      && typescript.isObjectLiteralExpression(outer.parent.parent)
    ) {
      return isMessageListenerObject(outer.parent.parent);
    }
    return false;
  };
  const isMessageHandler = (node) => {
    const outer = unwrapParentExpression(node);
    const parent = outer.parent;
    if (isMessageListenerObjectMember(outer)) return true;
    if (isGlobalMessageListenerCall(parent) && parent.arguments[1] === outer) return true;
    if (isGlobalMessageHandlerAssignment(parent) && parent.right === outer) return true;
    if (typescript.isFunctionDeclaration(outer)) {
      return Boolean(outer.name && namedMessageHandlers.has(outer.name.text));
    }
    return (
      (typescript.isArrowFunction(outer) || typescript.isFunctionExpression(outer))
      && typescript.isVariableDeclaration(parent)
      && parent.initializer === outer
      && typescript.isIdentifier(parent.name)
      && namedMessageHandlers.has(parent.name.text)
    );
  };
  const isMessageEventParameterReference = (value) => {
    const candidate = unwrapExpression(value);
    if (!typescript.isIdentifier(candidate)) return false;
    let cursor = candidate.parent;
    while (cursor) {
      if (
        isFunctionLike(cursor)
        && isMessageHandler(cursor)
        && cursor.parameters.some((parameter) => (
          typescript.isIdentifier(parameter.name) && parameter.name.text === candidate.text
        ))
      ) {
        return true;
      }
      cursor = cursor.parent;
    }
    return false;
  };
  const isGlobalMessageEventReference = (value) => {
    const candidate = unwrapExpression(value);
    return (
      typescript.isPropertyAccessExpression(candidate)
      && candidate.name.text === 'event'
      && isBrowserGlobalExpression(candidate.expression)
    ) || (
      typescript.isElementAccessExpression(candidate)
      && stringValue(candidate.argumentExpression) === 'event'
      && isBrowserGlobalExpression(candidate.expression)
    );
  };
  const isDirectTransportConstructor = (node) => (
    typescript.isIdentifier(node) && directTransportConstructors.has(node.text)
  ) || (
    typescript.isPropertyAccessExpression(node)
    && directTransportConstructors.has(node.name.text)
  );
  const domNodeTypePattern = '(?:HTML[A-Za-z0-9]*Element|SVG[A-Za-z0-9]*Element|HTMLElement|SVGElement|Element|Node|Document|HTMLDocument)';
  const domNodeFactoryMethods = new Set([
    'createElement',
    'createElementNS',
    'getElementById',
    'getElementsByClassName',
    'getElementsByName',
    'getElementsByTagName',
    'getElementsByTagNameNS',
    'querySelector',
    'querySelectorAll',
  ]);
  const domNodeDocumentProperties = new Set(['activeElement', 'body', 'documentElement']);
  const dynamicMemberAliases = new Set();
  const domNodeAliases = new Set();
  const domNodeAliasCandidates = [];
  const dynamicMemberAliasCandidates = [];
  const bindingNames = (binding) => {
    const names = [];
    const collect = (candidate) => {
      if (!candidate) return;
      if (typescript.isIdentifier(candidate)) {
        names.push(candidate.text);
        return;
      }
      if (typescript.isBindingElement(candidate)) {
        collect(candidate.name);
        return;
      }
      if (
        typescript.isArrayBindingPattern(candidate)
        || typescript.isObjectBindingPattern(candidate)
        || typescript.isArrayLiteralExpression(candidate)
      ) {
        for (const element of candidate.elements) collect(element);
        return;
      }
      if (typescript.isObjectLiteralExpression(candidate)) {
        for (const property of candidate.properties) collect(property);
        return;
      }
      if (typescript.isPropertyAssignment(candidate)) {
        collect(candidate.initializer);
        return;
      }
      if (typescript.isShorthandPropertyAssignment(candidate)) {
        collect(candidate.name);
        return;
      }
      if (typescript.isSpreadElement(candidate) || typescript.isSpreadAssignment(candidate)) {
        collect(candidate.expression);
      }
    };
    collect(binding);
    return names;
  };
  const isDomTypedBinding = (node) => {
    if (!node.type) return false;
    const typeText = node.type.getText(sourceFile).replaceAll(/\s+/g, '');
    return new RegExp(`^${domNodeTypePattern}(?:\\|(?:${domNodeTypePattern}|null|undefined))*$`).test(typeText);
  };
  const isDocumentRoot = (node) => {
    const candidate = unwrapExpression(node);
    return (
      typescript.isIdentifier(candidate) && candidate.text === 'document'
    ) || (
      typescript.isPropertyAccessExpression(candidate)
      && candidate.name.text === 'document'
      && isBrowserGlobalExpression(candidate.expression)
    );
  };
  const isDomNodeExpression = (node) => {
    const candidate = unwrapExpression(node);
    if (isDocumentRoot(candidate)) return true;
    if (
      typescript.isIdentifier(candidate)
      && domNodeAliases.has(candidate.text)
    ) return true;
    if (
      typescript.isPropertyAccessExpression(candidate)
      && domNodeDocumentProperties.has(candidate.name.text)
      && isDocumentRoot(candidate.expression)
    ) return true;
    if (!typescript.isCallExpression(candidate)) return false;
    const callee = unwrapExpression(candidate.expression);
    const method = typescript.isPropertyAccessExpression(callee)
      ? callee.name.text
      : typescript.isElementAccessExpression(callee)
      ? stringValue(callee.argumentExpression)
      : null;
    const receiver = (
      typescript.isPropertyAccessExpression(callee)
      || typescript.isElementAccessExpression(callee)
    ) ? callee.expression : null;
    return Boolean(
      method
      && domNodeFactoryMethods.has(method)
      && receiver
      && (isDocumentRoot(receiver) || isDomNodeExpression(receiver)),
    );
  };
  const containsDomNodeExpression = (node) => {
    let found = false;
    const visitCandidate = (candidate) => {
      if (found || !candidate) return;
      const current = unwrapExpression(candidate);
      if (isDomNodeExpression(current)) {
        found = true;
        return;
      }
      typescript.forEachChild(current, visitCandidate);
    };
    visitCandidate(node);
    return found;
  };
  const containsDynamicMemberAlias = (node) => {
    let found = false;
    const visitCandidate = (candidate) => {
      if (found || !candidate) return;
      const current = unwrapExpression(candidate);
      if (
        typescript.isIdentifier(current)
        && dynamicMemberAliases.has(current.text)
      ) {
        found = true;
        return;
      }
      typescript.forEachChild(current, visitCandidate);
    };
    visitCandidate(node);
    return found;
  };
  const isDangerousDynamicMemberRead = (node) => {
    let found = false;
    const visitCandidate = (candidate) => {
      if (found || !candidate) return;
      const current = unwrapExpression(candidate);
      if (
        typescript.isElementAccessExpression(current)
        && stringValue(current.argumentExpression) === null
        && (
          isBrowserGlobalExpression(current.expression)
          || containsDomNodeExpression(current.expression)
          || containsDynamicMemberAlias(current.expression)
        )
      ) {
        found = true;
        return;
      }
      typescript.forEachChild(current, visitCandidate);
    };
    visitCandidate(node);
    return found;
  };
  const assignmentReceiverNames = (target) => {
    const candidate = unwrapExpression(target);
    if (
      typescript.isPropertyAccessExpression(candidate)
      || typescript.isElementAccessExpression(candidate)
    ) return bindingNames(candidate.expression);
    return [];
  };
  const collectDynamicMemberAliasCandidates = (node) => {
    if (typescript.isParameter(node) && isDomTypedBinding(node)) {
      for (const name of bindingNames(node.name)) domNodeAliases.add(name);
    }
    if (typescript.isVariableDeclaration(node)) {
      if (isDomTypedBinding(node)) {
        for (const name of bindingNames(node.name)) domNodeAliases.add(name);
      }
      if (node.initializer) {
        for (const name of bindingNames(node.name)) {
          domNodeAliasCandidates.push([name, unwrapExpression(node.initializer)]);
          dynamicMemberAliasCandidates.push([name, unwrapExpression(node.initializer)]);
        }
      }
    }
    if (
      typescript.isBinaryExpression(node)
      && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
    ) {
      const names = [...bindingNames(node.left), ...assignmentReceiverNames(node.left)];
      for (const name of names) {
        domNodeAliasCandidates.push([name, unwrapExpression(node.right)]);
        dynamicMemberAliasCandidates.push([name, unwrapExpression(node.right)]);
      }
    }
    typescript.forEachChild(node, collectDynamicMemberAliasCandidates);
  };
  collectDynamicMemberAliasCandidates(sourceFile);
  let addedDomNodeAlias = true;
  while (addedDomNodeAlias) {
    addedDomNodeAlias = false;
    for (const [name, initializer] of domNodeAliasCandidates) {
      if (containsDomNodeExpression(initializer) && !domNodeAliases.has(name)) {
        domNodeAliases.add(name);
        addedDomNodeAlias = true;
      }
    }
  }
  let addedDynamicMemberAlias = true;
  while (addedDynamicMemberAlias) {
    addedDynamicMemberAlias = false;
    for (const [name, initializer] of dynamicMemberAliasCandidates) {
      if (
        (isDangerousDynamicMemberRead(initializer) || containsDynamicMemberAlias(initializer))
        && !dynamicMemberAliases.has(name)
      ) {
        dynamicMemberAliases.add(name);
        addedDynamicMemberAlias = true;
      }
    }
  }
  const containsAnyDynamicMemberRead = (node) => {
    let found = false;
    const visitCandidate = (candidate) => {
      if (found || !candidate) return;
      const current = unwrapExpression(candidate);
      if (
        typescript.isElementAccessExpression(current)
        && stringValue(current.argumentExpression) === null
      ) {
        found = true;
        return;
      }
      typescript.forEachChild(current, visitCandidate);
    };
    visitCandidate(node);
    return found;
  };
  const dynamicMemberFunctionAliases = new Set();
  const dynamicMemberFunctionAliasCandidates = [];
  const isDynamicMemberFunction = (node) => {
    const candidate = unwrapExpression(node);
    return (
      typescript.isIdentifier(candidate)
      && dynamicMemberFunctionAliases.has(candidate.text)
    ) || (
      (typescript.isArrowFunction(candidate) || typescript.isFunctionExpression(candidate))
      && containsAnyDynamicMemberRead(candidate.body)
    );
  };
  const collectDynamicMemberFunctionAliases = (node) => {
    if (
      typescript.isFunctionDeclaration(node)
      && node.name
      && node.body
      && containsAnyDynamicMemberRead(node.body)
    ) {
      dynamicMemberFunctionAliases.add(node.name.text);
    }
    if (typescript.isVariableDeclaration(node) && typescript.isIdentifier(node.name) && node.initializer) {
      if (
        (typescript.isArrowFunction(unwrapExpression(node.initializer))
          || typescript.isFunctionExpression(unwrapExpression(node.initializer)))
        && containsAnyDynamicMemberRead(unwrapExpression(node.initializer))
      ) {
        dynamicMemberFunctionAliases.add(node.name.text);
      } else {
        dynamicMemberFunctionAliasCandidates.push([node.name.text, unwrapExpression(node.initializer)]);
      }
    }
    if (
      typescript.isBinaryExpression(node)
      && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
      && typescript.isIdentifier(node.left)
    ) {
      dynamicMemberFunctionAliasCandidates.push([node.left.text, unwrapExpression(node.right)]);
    }
    typescript.forEachChild(node, collectDynamicMemberFunctionAliases);
  };
  collectDynamicMemberFunctionAliases(sourceFile);
  let addedDynamicMemberFunctionAlias = true;
  while (addedDynamicMemberFunctionAlias) {
    addedDynamicMemberFunctionAlias = false;
    for (const [name, initializer] of dynamicMemberFunctionAliasCandidates) {
      if (
        typescript.isIdentifier(initializer)
        && dynamicMemberFunctionAliases.has(initializer.text)
        && !dynamicMemberFunctionAliases.has(name)
      ) {
        dynamicMemberFunctionAliases.add(name);
        addedDynamicMemberFunctionAlias = true;
      }
    }
  }
  const hasLocalOpenBinding = (() => {
    let found = false;
    const collect = (node) => {
      if (found) return;
      if (
        (typescript.isVariableDeclaration(node) || typescript.isParameter(node))
        && bindingNames(node.name).includes('open')
      ) {
        found = true;
        return;
      }
      if (
        (typescript.isFunctionDeclaration(node) || typescript.isClassDeclaration(node))
        && node.name
        && node.name.text === 'open'
      ) {
        found = true;
        return;
      }
      if (
        typescript.isImportSpecifier(node)
        && node.name.text === 'open'
      ) {
        found = true;
        return;
      }
      typescript.forEachChild(node, collect);
    };
    collect(sourceFile);
    return found;
  })();
  const isBareGlobalOpenCall = (node) => (
    !hasLocalOpenBinding
    && typescript.isCallExpression(node)
    && typescript.isIdentifier(unwrapExpression(node.expression))
    && unwrapExpression(node.expression).text === 'open'
  );
  const rawPostgrestPathAliases = new Map();
  const rawPostgrestPathCandidates = [];
  const mergeRawPostgrestPathSignal = (target, source) => {
    target.rest ||= source.rest;
    target.v1 ||= source.v1;
    target.base ||= source.base;
  };
  const rawPostgrestAliasName = (node) => {
    const current = unwrapExpression(node);
    if (typescript.isIdentifier(current)) return current.text;
    if (typescript.isPropertyAccessExpression(current)) {
      const receiver = rawPostgrestAliasName(current.expression);
      return receiver ? `${receiver}.${current.name.text}` : null;
    }
    if (typescript.isElementAccessExpression(current)) {
      const receiver = rawPostgrestAliasName(current.expression);
      const member = stringValue(current.argumentExpression);
      return receiver && member ? `${receiver}.${member}` : null;
    }
    if (typescript.isCallExpression(current) || typescript.isNewExpression(current)) {
      return rawPostgrestAliasName(current.expression);
    }
    return null;
  };
  const staticNumberValue = (node) => {
    const current = unwrapExpression(node);
    if (typescript.isNumericLiteral(current)) return Number(current.text);
    if (
      typescript.isPrefixUnaryExpression(current)
      && (current.operator === typescript.SyntaxKind.PlusToken || current.operator === typescript.SyntaxKind.MinusToken)
      && typescript.isNumericLiteral(current.operand)
    ) {
      const value = Number(current.operand.text);
      return current.operator === typescript.SyntaxKind.MinusToken ? -value : value;
    }
    return null;
  };
  const staticEncodedString = (node) => {
    const current = unwrapExpression(node);
    if (!typescript.isCallExpression(current)) return null;
    const callee = unwrapExpression(current.expression);
    if (
      typescript.isPropertyAccessExpression(callee)
      && typescript.isIdentifier(callee.expression)
      && callee.expression.text === 'JSON'
      && callee.name.text === 'parse'
      && current.arguments.length === 1
    ) {
      const encoded = stringValue(unwrapExpression(current.arguments[0]));
      if (encoded === null) return null;
      try {
        const parsed = JSON.parse(encoded);
        return typeof parsed === 'string' ? parsed : null;
      } catch {
        return null;
      }
    }
    if (
      typescript.isPropertyAccessExpression(callee)
      && typescript.isIdentifier(callee.expression)
      && callee.expression.text === 'String'
      && ['fromCharCode', 'fromCodePoint'].includes(callee.name.text)
    ) {
      const values = [];
      for (const argument of current.arguments) {
        if (typescript.isSpreadElement(argument)) {
          const spread = unwrapExpression(argument.expression);
          if (!typescript.isArrayLiteralExpression(spread)) return null;
          for (const element of spread.elements) {
            if (typescript.isSpreadElement(element) || typescript.isOmittedExpression(element)) return null;
            const value = staticNumberValue(element);
            if (value === null) return null;
            values.push(value);
          }
          continue;
        }
        const value = staticNumberValue(argument);
        if (value === null) return null;
        values.push(value);
      }
      try {
        return callee.name.text === 'fromCodePoint'
          ? String.fromCodePoint(...values)
          : String.fromCharCode(...values);
      } catch {
        return null;
      }
    }
    if (!typescript.isIdentifier(callee) || current.arguments.length !== 1) return null;
    const encoded = stringValue(unwrapExpression(current.arguments[0]));
    if (encoded === null) return null;
    try {
      if (callee.text === 'decodeURIComponent') return decodeURIComponent(encoded);
      if (callee.text === 'decodeURI') return decodeURI(encoded);
      if (callee.text === 'atob') return Buffer.from(encoded, 'base64').toString('latin1');
      if (callee.text === 'unescape') return unescape(encoded);
    } catch {
      return null;
    }
    return null;
  };
  const encodedStringDecoderNames = new Set(['atob', 'decodeURI', 'decodeURIComponent', 'fromCharCode', 'fromCodePoint', 'unescape']);
  const isUnsupportedEncodedStringDecoderReference = (node) => {
    const current = unwrapExpression(node);
    const isStringDecoder = (
      (typescript.isPropertyAccessExpression(current)
        && typescript.isIdentifier(current.expression)
        && current.expression.text === 'String'
        && encodedStringDecoderNames.has(current.name.text))
      || (typescript.isElementAccessExpression(current)
        && typescript.isIdentifier(current.expression)
        && current.expression.text === 'String'
        && encodedStringDecoderNames.has(stringValue(current.argumentExpression) ?? ''))
    );
    const isGlobalDecoder = (
      typescript.isIdentifier(current)
      && encodedStringDecoderNames.has(current.text)
      && !(
        typescript.isPropertyAccessExpression(current.parent)
        && current.parent.name === current
      )
    );
    if (!isStringDecoder && !isGlobalDecoder) return false;
    const call = current.parent;
    return !(
      typescript.isCallExpression(call)
      && call.expression === current
      && staticEncodedString(call) !== null
    );
  };
  const rawPostgrestPathSignal = (node) => {
    const signal = { rest: false, v1: false, base: false };
    const literalFragments = [];
    const visitCandidate = (candidate) => {
      if (!candidate) return;
      const current = unwrapExpression(candidate);
      const aliasName = rawPostgrestAliasName(current);
      if (aliasName && rawPostgrestPathAliases.has(aliasName)) {
        mergeRawPostgrestPathSignal(signal, rawPostgrestPathAliases.get(aliasName));
        return;
      }
      const decodedString = staticEncodedString(current);
      if (decodedString !== null) {
        literalFragments.push(decodedString);
        return;
      }
      if (
        typescript.isStringLiteral(current)
        || typescript.isNoSubstitutionTemplateLiteral(current)
        || typescript.isNumericLiteral(current)
        || typescript.isTemplateHead(current)
        || typescript.isTemplateMiddle(current)
        || typescript.isTemplateTail(current)
      ) {
        literalFragments.push(current.text);
        return;
      }
      typescript.forEachChild(current, visitCandidate);
    };
    visitCandidate(node);
    const literalText = literalFragments.join('').toLowerCase();
    signal.rest ||= literalText.includes('rest');
    signal.v1 ||= literalText.includes('v1');
    signal.base ||= /https?:\/\/[^\s"'`<>]*\.supabase\.co\b/i.test(literalText);
    return signal;
  };
  const isRawPostgrestEndpointExpression = (node) => {
    const signal = rawPostgrestPathSignal(node);
    return signal.rest && signal.v1;
  };
  const isRawPostgrestRouteMaterialization = (node) => (
    typescript.isExpression(node)
    && isRawPostgrestEndpointExpression(node)
  );
  const isUnapprovedSupabaseBaseMaterialization = (node) => (
    file.path !== 'src/integrations/supabase/client.ts'
    && typescript.isExpression(node)
    && rawPostgrestPathSignal(node).base
  );
  const collectCallableReturnCandidates = (callable, names) => {
    if (!callable.body) return;
    const collectReturnExpressions = (candidate) => {
      if (
        candidate !== callable.body
        && (
          typescript.isFunctionDeclaration(candidate)
          || typescript.isFunctionExpression(candidate)
          || typescript.isArrowFunction(candidate)
          || typescript.isMethodDeclaration(candidate)
          || typescript.isGetAccessorDeclaration(candidate)
          || typescript.isSetAccessorDeclaration(candidate)
          || typescript.isClassDeclaration(candidate)
          || typescript.isClassExpression(candidate)
        )
      ) return;
      if (typescript.isReturnStatement(candidate) && candidate.expression) {
        for (const name of names) {
          rawPostgrestPathCandidates.push([name, unwrapExpression(candidate.expression)]);
        }
      }
      typescript.forEachChild(candidate, collectReturnExpressions);
    };
    collectReturnExpressions(callable.body);
  };
  const classMemberAliasNames = (member) => {
    const owner = member.parent;
    const memberName = propertyName(member);
    if (
      !memberName
      || !(typescript.isClassDeclaration(owner) || typescript.isClassExpression(owner))
      || !owner.name
    ) return [];
    const names = [owner.name.text];
    if (member.modifiers?.some((modifier) => modifier.kind === typescript.SyntaxKind.StaticKeyword)) {
      names.push(`${owner.name.text}.${memberName}`);
    }
    return names;
  };
  const collectRawPostgrestPathAliases = (node) => {
    if (typescript.isVariableDeclaration(node) && node.initializer) {
      for (const name of bindingNames(node.name)) {
        rawPostgrestPathCandidates.push([name, unwrapExpression(node.initializer)]);
      }
    }
    if (typescript.isParameter(node) && node.initializer) {
      for (const name of bindingNames(node.name)) {
        rawPostgrestPathCandidates.push([name, unwrapExpression(node.initializer)]);
      }
    }
    if (typescript.isBindingElement(node) && node.initializer) {
      for (const name of bindingNames(node.name)) {
        rawPostgrestPathCandidates.push([name, unwrapExpression(node.initializer)]);
      }
    }
    if (typescript.isFunctionDeclaration(node) && node.name && node.body) {
      // Resource URL taint must survive a local function declaration and its
      // aliases, otherwise `src={makeRawEndpoint()}` bypasses the sink checks.
      collectCallableReturnCandidates(node, [node.name.text]);
    }
    const classMemberNames = (
      typescript.isMethodDeclaration(node)
      || typescript.isGetAccessorDeclaration(node)
      || typescript.isPropertyDeclaration(node)
    ) ? classMemberAliasNames(node) : [];
    if (
      classMemberNames.length > 0
      && (typescript.isMethodDeclaration(node) || typescript.isGetAccessorDeclaration(node))
    ) {
      collectCallableReturnCandidates(node, classMemberNames);
    }
    if (
      classMemberNames.length > 0
      && typescript.isPropertyDeclaration(node)
      && node.initializer
    ) {
      for (const name of classMemberNames) {
        rawPostgrestPathCandidates.push([name, unwrapExpression(node.initializer)]);
      }
    }
    if (
      typescript.isBinaryExpression(node)
      && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
    ) {
      for (const name of [...bindingNames(node.left), ...assignmentReceiverNames(node.left)]) {
        rawPostgrestPathCandidates.push([name, unwrapExpression(node.right)]);
      }
    }
    typescript.forEachChild(node, collectRawPostgrestPathAliases);
  };
  collectRawPostgrestPathAliases(sourceFile);
  let addedRawPostgrestPathAlias = true;
  while (addedRawPostgrestPathAlias) {
    addedRawPostgrestPathAlias = false;
    for (const [name, initializer] of rawPostgrestPathCandidates) {
      const next = rawPostgrestPathSignal(initializer);
      const current = rawPostgrestPathAliases.get(name) ?? { rest: false, v1: false, base: false };
      if ((next.rest && !current.rest) || (next.v1 && !current.v1) || (next.base && !current.base)) {
        mergeRawPostgrestPathSignal(current, next);
        rawPostgrestPathAliases.set(name, current);
        addedRawPostgrestPathAlias = true;
      }
    }
  }
  const resourceAttributeNames = new Set(['action', 'background', 'data', 'formAction', 'href', 'imageSrcSet', 'imageSrcset', 'imagesrcset', 'ping', 'poster', 'src', 'srcSet', 'srcset', 'xlink:href', 'xlinkHref']);
  const isResourceSinkMember = (node) => {
    if (
      typescript.isPropertyAccessExpression(node)
      && resourceAttributeNames.has(node.name.text)
    ) return true;
    if (
      typescript.isElementAccessExpression(node)
      && resourceAttributeNames.has(stringValue(node.argumentExpression) ?? '')
    ) return true;
    // SVG exposes URL-bearing `href` values as an SVGAnimatedString, whose
    // writable URL is `.baseVal` rather than the outer property itself.
    return (
      typescript.isPropertyAccessExpression(node)
      && node.name.text === 'baseVal'
      && isResourceSinkMember(unwrapExpression(node.expression))
    ) || (
      typescript.isElementAccessExpression(node)
      && stringValue(node.argumentExpression) === 'baseVal'
      && isResourceSinkMember(unwrapExpression(node.expression))
    );
  };
  const jsxAttributeValue = (node) => {
    if (!node.initializer) return null;
    if (typescript.isStringLiteral(node.initializer)) return node.initializer;
    if (typescript.isJsxExpression(node.initializer)) return node.initializer.expression;
    return null;
  };
  const containsUnreviewedResourceUrlResolution = (node) => {
    let found = false;
    const visitCandidate = (candidate) => {
      if (found || !candidate) return;
      const current = unwrapExpression(candidate);
      if (
        typescript.isCallExpression(current)
        || typescript.isNewExpression(current)
      ) {
        found = true;
        return;
      }
      typescript.forEachChild(current, visitCandidate);
    };
    visitCandidate(node);
    return found;
  };
  const importedRuntimeModule = (node) => {
    const current = unwrapExpression(node);
    if (typescript.isIdentifier(current)) return runtimeImportBindings.get(current.text) ?? null;
    if (typescript.isPropertyAccessExpression(current) || typescript.isElementAccessExpression(current)) {
      return importedRuntimeModule(current.expression);
    }
    return null;
  };
  const containsImportedRuntimeResourceValue = (node) => {
    let found = false;
    const visitCandidate = (candidate) => {
      if (found || !candidate) return;
      const current = unwrapExpression(candidate);
      if (importedRuntimeModule(current)) {
        found = true;
        return;
      }
      typescript.forEachChild(current, visitCandidate);
    };
    visitCandidate(node);
    return found;
  };
  const documentBaseHref = typeof file.documentBaseHref === 'string' ? file.documentBaseHref : null;
  const documentBaseUrl = documentBaseHref ? resolveStaticHtmlUrl('', documentBaseHref) : null;
  const documentBaseSignal = {
    rest: Boolean(documentBaseUrl && /(?:^|\/)rest(?:\/|$)/i.test(documentBaseUrl)),
    v1: Boolean(documentBaseUrl && /(?:^|\/)v1(?:\/|$)/i.test(documentBaseUrl)),
  };
  const staticResourceUrlValue = (node) => {
    const current = unwrapExpression(node);
    return stringValue(current);
  };
  const isBaseResolvedRawPostgrestResourceExpression = (node) => {
    if (!documentBaseHref) return false;
    const literal = staticResourceUrlValue(node);
    if (literal !== null) {
      return /(?:^|\/)rest\/v1(?:[/?#]|$)/i.test(
        resolveStaticHtmlUrl(literal, documentBaseHref).replace(/\s+/g, ''),
      );
    }
    const signal = rawPostgrestPathSignal(node);
    if ((documentBaseSignal.rest && signal.v1) || (documentBaseSignal.v1 && signal.rest)) return true;
    // A dynamic URL against a base that already names part of the raw
    // PostgREST route cannot be proven safe without executing browser code.
    return documentBaseSignal.rest || documentBaseSignal.v1;
  };
  const isUnsafeResourceUrlExpression = (node) => (
    isRawPostgrestEndpointExpression(node)
    // Arbitrary helper, class-method, and cross-module return values cannot be
    // proven safe by this bounded source contract. There is no reviewed
    // call-based browser resource URL in the client, so resource sinks fail
    // closed until one is explicitly modeled with a regression fixture.
    || containsUnreviewedResourceUrlResolution(node)
    // Cross-file return values are intentionally not inferred from an
    // unbounded module graph. Imported runtime values at a resource sink must
    // therefore be modeled explicitly instead of becoming an opaque URL path.
    || containsImportedRuntimeResourceValue(node)
    || isBaseResolvedRawPostgrestResourceExpression(node)
  );
  const isHrefSinkMember = (node) => (
    typescript.isPropertyAccessExpression(node)
    && node.name.text === 'href'
  ) || (
    typescript.isElementAccessExpression(node)
    && stringValue(node.argumentExpression) === 'href'
  );
  const isStaticSafeRuntimeHrefValue = (node) => {
    const literal = staticResourceUrlValue(node);
    if (literal === null) return false;
    const signal = rawPostgrestPathSignal(node);
    return !signal.rest && !signal.v1;
  };
  const isPartialRawPostgrestPathExpression = (node) => {
    const signal = rawPostgrestPathSignal(node);
    return signal.rest || signal.v1;
  };
  const isAttributeValueMember = (node) => {
    const attributeValueNames = new Set(['nodeValue', 'textContent', 'value']);
    return (
      typescript.isPropertyAccessExpression(node)
      && attributeValueNames.has(node.name.text)
    ) || (
      typescript.isElementAccessExpression(node)
      && attributeValueNames.has(stringValue(node.argumentExpression) ?? '')
    );
  };
  const isPartialRawAttributeValueAssignment = (node) => (
    typescript.isBinaryExpression(node)
    && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
    && isAttributeValueMember(unwrapExpression(node.left))
    && isPartialRawPostgrestPathExpression(node.right)
  );
  const markupSinkNames = new Set(['innerHTML', 'outerHTML', 'srcdoc']);
  const isMarkupSinkMember = (node) => (
    typescript.isPropertyAccessExpression(node)
    && markupSinkNames.has(node.name.text)
  ) || (
    typescript.isElementAccessExpression(node)
    && markupSinkNames.has(stringValue(node.argumentExpression) ?? '')
  );
  const isPartialRawMarkupAssignment = (node) => (
    typescript.isBinaryExpression(node)
    && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
    && isMarkupSinkMember(unwrapExpression(node.left))
    && isPartialRawPostgrestPathExpression(node.right)
  );
  const isPartialRawMarkupCall = (node) => {
    if (!typescript.isCallExpression(node)) return false;
    const callee = unwrapExpression(node.expression);
    const method = typescript.isPropertyAccessExpression(callee)
      ? callee.name.text
      : typescript.isElementAccessExpression(callee)
      ? stringValue(callee.argumentExpression)
      : null;
    const valueIndex = method === 'insertAdjacentHTML' ? 1 : 0;
    return (
      ['createContextualFragment', 'insertAdjacentHTML', 'parseFromString', 'write', 'writeln'].includes(method ?? '')
      && node.arguments.length > valueIndex
      && isPartialRawPostgrestPathExpression(node.arguments[valueIndex])
    );
  };
  const isPartialRawMarkupSetAttribute = (node) => {
    if (!typescript.isCallExpression(node) || node.arguments.length < 2) return false;
    const callee = unwrapExpression(node.expression);
    const method = typescript.isPropertyAccessExpression(callee)
      ? callee.name.text
      : typescript.isElementAccessExpression(callee)
      ? stringValue(callee.argumentExpression)
      : null;
    const namespaced = method === 'setAttributeNS';
    const attributeIndex = namespaced ? 1 : 0;
    const valueIndex = namespaced ? 2 : 1;
    return (
      (method === 'setAttribute' || namespaced)
      && node.arguments.length > valueIndex
      && stringValue(node.arguments[attributeIndex]) === 'srcdoc'
      && isPartialRawPostgrestPathExpression(node.arguments[valueIndex])
    );
  };
  const isPartialRawDangerouslySetInnerHtml = (node) => {
    if (!typescript.isJsxAttribute(node) || node.name.text !== 'dangerouslySetInnerHTML') return false;
    const value = jsxAttributeValue(node);
    return Boolean(value && isPartialRawPostgrestPathExpression(value));
  };
  const isUnsafeRuntimeHrefAssignment = (node) => (
    typescript.isBinaryExpression(node)
    && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
    && isHrefSinkMember(unwrapExpression(node.left))
    && !isStaticSafeRuntimeHrefValue(node.right)
  );
  const isUnsafeRuntimeHrefSetAttribute = (node) => {
    if (!typescript.isCallExpression(node) || node.arguments.length < 2) return false;
    const callee = unwrapExpression(node.expression);
    const method = typescript.isPropertyAccessExpression(callee)
      ? callee.name.text
      : typescript.isElementAccessExpression(callee)
      ? stringValue(callee.argumentExpression)
      : null;
    const namespaced = method === 'setAttributeNS';
    const attributeIndex = namespaced ? 1 : 0;
    const valueIndex = namespaced ? 2 : 1;
    return (
      (method === 'setAttribute' || namespaced)
      && node.arguments.length > valueIndex
      && stringValue(node.arguments[attributeIndex]) === 'href'
      && !isStaticSafeRuntimeHrefValue(node.arguments[valueIndex])
    );
  };
  const isUnsafeRuntimeBaseJsxHref = (node) => {
    if (!typescript.isJsxAttribute(node) || node.name.text !== 'href') return false;
    const opening = node.parent?.parent;
    if (
      !(typescript.isJsxOpeningElement(opening) || typescript.isJsxSelfClosingElement(opening))
      || opening.tagName.getText(sourceFile).toLowerCase() !== 'base'
    ) return false;
    const value = jsxAttributeValue(node);
    return Boolean(value && !isStaticSafeRuntimeHrefValue(value));
  };
  const isRawPostgrestJsxResourceAttribute = (node) => {
    if (!typescript.isJsxAttribute(node) || !resourceAttributeNames.has(node.name.text)) return false;
    const value = jsxAttributeValue(node);
    return Boolean(value && isUnsafeResourceUrlExpression(value));
  };
  const isRawPostgrestJsxPropBoundary = (node) => {
    const value = typescript.isJsxAttribute(node)
      ? jsxAttributeValue(node)
      : typescript.isJsxSpreadAttribute(node)
      ? node.expression
      : typescript.isJsxExpression(node)
      ? node.expression
      : null;
    return Boolean(value && isRawPostgrestEndpointExpression(value));
  };
  const isRawPostgrestSetAttribute = (node) => {
    if (!typescript.isCallExpression(node) || node.arguments.length < 2) return false;
    const callee = unwrapExpression(node.expression);
    const method = typescript.isPropertyAccessExpression(callee)
      ? callee.name.text
      : typescript.isElementAccessExpression(callee)
      ? stringValue(callee.argumentExpression)
      : null;
    const namespaced = method === 'setAttributeNS';
    const attributeIndex = namespaced ? 1 : 0;
    const valueIndex = namespaced ? 2 : 1;
    return (
      (method === 'setAttribute' || namespaced)
      && node.arguments.length > valueIndex
      && resourceAttributeNames.has(stringValue(node.arguments[attributeIndex]) ?? '')
      && isUnsafeResourceUrlExpression(node.arguments[valueIndex])
    );
  };
  const objectPropertyName = (property) => (
    typescript.isPropertyAssignment(property)
    || typescript.isShorthandPropertyAssignment(property)
  ) ? propertyName(property) : null;
  const descriptorHasUnsafeResourceValue = (node) => {
    const descriptor = unwrapExpression(node);
    if (!typescript.isObjectLiteralExpression(descriptor)) return isUnsafeResourceUrlExpression(descriptor);
    return descriptor.properties.some((property) => (
      typescript.isPropertyAssignment(property)
      && objectPropertyName(property) === 'value'
      && isUnsafeResourceUrlExpression(property.initializer)
    ) || (
      (typescript.isGetAccessorDeclaration(property) || typescript.isSetAccessorDeclaration(property))
      && isPartialRawPostgrestPathExpression(property)
    ));
  };
  const objectSourceHasUnsafeResourceValue = (node) => {
    const source = unwrapExpression(node);
    if (!typescript.isObjectLiteralExpression(source)) return isUnsafeResourceUrlExpression(source);
    return source.properties.some((property) => {
      if (typescript.isSpreadAssignment(property)) return objectSourceHasUnsafeResourceValue(property.expression);
      const name = objectPropertyName(property);
      if (!name || !resourceAttributeNames.has(name)) return false;
      if (typescript.isPropertyAssignment(property)) return isUnsafeResourceUrlExpression(property.initializer);
      if (typescript.isShorthandPropertyAssignment(property)) return isUnsafeResourceUrlExpression(property.name);
      return false;
    });
  };
  const isObjectResourceMutation = (node) => {
    if (!typescript.isCallExpression(node)) return false;
    const callee = unwrapExpression(node.expression);
    const method = typescript.isPropertyAccessExpression(callee)
      ? callee.name.text
      : typescript.isElementAccessExpression(callee)
      ? stringValue(callee.argumentExpression)
      : null;
    const receiver = (typescript.isPropertyAccessExpression(callee) || typescript.isElementAccessExpression(callee))
      ? unwrapExpression(callee.expression)
      : null;
    const receiverName = receiver && typescript.isIdentifier(receiver) ? receiver.text : null;
    if (receiverName === 'Object' && method === 'assign') {
      return node.arguments.slice(1).some(objectSourceHasUnsafeResourceValue);
    }
    if (receiverName === 'Object' && method === 'defineProperty' && node.arguments.length >= 3) {
      return (
        resourceAttributeNames.has(stringValue(node.arguments[1]) ?? '')
        && descriptorHasUnsafeResourceValue(node.arguments[2])
      );
    }
    if (receiverName === 'Object' && method === 'defineProperties' && node.arguments.length >= 2) {
      const descriptors = unwrapExpression(node.arguments[1]);
      if (!typescript.isObjectLiteralExpression(descriptors)) return isUnsafeResourceUrlExpression(descriptors);
      return descriptors.properties.some((property) => (
        typescript.isPropertyAssignment(property)
        && resourceAttributeNames.has(objectPropertyName(property) ?? '')
        && descriptorHasUnsafeResourceValue(property.initializer)
      ));
    }
    return (
      receiverName === 'Reflect'
      && method === 'set'
      && node.arguments.length >= 3
      && resourceAttributeNames.has(stringValue(node.arguments[1]) ?? '')
      && isUnsafeResourceUrlExpression(node.arguments[2])
    );
  };
  const visit = (node) => {
      if (isGlobalMessageHandlerAssignment(node)) {
        issues.push(`${file.path}: browser source may not register a global message handler`);
      }
      if (isLocationNavigationMember(node) || isLocationNavigationAssignment(node)) {
        issues.push(`${file.path}: browser source may not navigate through the global Location transport`);
      }
      if (isBareGlobalOpenCall(node) || isGlobalOpenCall(node) || isGlobalOpenMember(node)) {
        issues.push(`${file.path}: browser source may not navigate through the global open transport`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && isLocationExpression(node.expression)
        && stringValue(node.argumentExpression) === null
      ) {
        issues.push(`${file.path}: browser source may not use computed global Location dispatch`);
      }
      if (isRawPostgrestJsxPropBoundary(node)) {
        // A custom component can forward an arbitrary prop or child to a DOM
        // resource attribute after React invokes it. Browser code has no
        // approved raw PostgREST endpoint, so reject it at the JSX boundary.
        issues.push(`${file.path}: browser source may not forward a raw PostgREST endpoint through a JSX boundary`);
      } else if (isRawPostgrestJsxResourceAttribute(node)) {
        issues.push(`${file.path}: browser source may not use an unreviewed or raw PostgREST URL through a JSX resource attribute`);
      }
      if (isUnsafeRuntimeBaseJsxHref(node)) {
        issues.push(`${file.path}: browser source may not mutate a document base with a dynamic or partial raw-route href`);
      }
      if (isUnsafeRuntimeHrefAssignment(node)) {
        issues.push(`${file.path}: browser source may not assign a dynamic or partial raw-route DOM href`);
      }
      if (isUnsafeRuntimeHrefSetAttribute(node)) {
        issues.push(`${file.path}: browser source may not set a dynamic or partial raw-route DOM href`);
      }
      if (isPartialRawAttributeValueAssignment(node)) {
        issues.push(`${file.path}: browser source may not assign a partial raw route through a DOM Attr value`);
      }
      if (isPartialRawMarkupAssignment(node) || isPartialRawMarkupCall(node) || isPartialRawMarkupSetAttribute(node)) {
        issues.push(`${file.path}: browser source may not install partial raw-route DOM markup`);
      }
      if (isPartialRawDangerouslySetInnerHtml(node)) {
        issues.push(`${file.path}: browser source may not install partial raw-route JSX markup`);
      }
      if (
        typescript.isBinaryExpression(node)
        && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
        && isResourceSinkMember(unwrapExpression(node.left))
        && isUnsafeResourceUrlExpression(node.right)
      ) {
        issues.push(`${file.path}: browser source may not use an unreviewed or raw PostgREST URL through a DOM resource attribute`);
      }
      if (isRawPostgrestSetAttribute(node)) {
        issues.push(`${file.path}: browser source may not use an unreviewed or raw PostgREST URL through setAttribute`);
      }
      if (isObjectResourceMutation(node)) {
        issues.push(`${file.path}: browser source may not use an unreviewed or raw PostgREST URL through an object mutation helper`);
      }
      if (isUnsupportedEncodedStringDecoderReference(node)) {
        issues.push(`${file.path}: browser source may not use an unreviewed encoded-route decoder`);
      }
      if (
        typescript.isIdentifier(node)
        && unreviewedBinaryRoutePrimitiveNames.has(node.text)
      ) {
        issues.push(`${file.path}: browser source may not use an unreviewed binary route-construction primitive`);
      }
      if (isUnapprovedSupabaseBaseMaterialization(node)) {
        issues.push(`${file.path}: browser source may not materialize a Supabase project base outside the reviewed client module`);
      }
      if (isRawPostgrestRouteMaterialization(node)) {
        // The reviewed browser surface has no legitimate raw PostgREST route.
        // Rejecting the route itself, not merely known transport and DOM sinks,
        // prevents it from being laundered through arbitrary setters, carriers,
        // callbacks, or framework-specific invocation behavior.
        issues.push(`${file.path}: browser source may not materialize a raw PostgREST endpoint`);
      }
      if (
        (
          (typescript.isCallExpression(node) || typescript.isNewExpression(node))
          && (node.arguments?.some((argument) => isRawPostgrestEndpointExpression(argument)) ?? false)
        ) || (
          typescript.isTaggedTemplateExpression(node)
          && isRawPostgrestEndpointExpression(node.template)
        )
      ) {
        // Browser code has no approved raw PostgREST transport. Disallowing a
        // raw endpoint at every callable boundary (calls, constructors, and
        // tags) prevents parameter laundering and aliases of mutation helpers
        // from reaching a later DOM setter.
        issues.push(`${file.path}: browser source may not forward a raw PostgREST endpoint through a callable boundary`);
      }
      if (
        (typescript.isArrayLiteralExpression(node) || typescript.isObjectLiteralExpression(node))
        && (isDangerousDynamicMemberRead(node) || containsDynamicMemberAlias(node))
      ) {
        issues.push(`${file.path}: browser source may not package a dynamically derived DOM transport host`);
      }
      if (
        (typescript.isReturnStatement(node) || typescript.isThrowStatement(node) || typescript.isYieldExpression(node))
        && node.expression
        && (isDangerousDynamicMemberRead(node.expression) || containsDynamicMemberAlias(node.expression))
      ) {
        issues.push(`${file.path}: browser source may not transfer a dynamically derived DOM transport host`);
      }
      if (
        typescript.isNewExpression(node)
        && (
          isDangerousDynamicMemberRead(node.expression)
          || containsDynamicMemberAlias(node.expression)
          || node.arguments?.some((argument) => (
            isDangerousDynamicMemberRead(argument) || containsDynamicMemberAlias(argument)
          ))
        )
      ) {
        issues.push(`${file.path}: browser source may not construct through a dynamically derived DOM transport host`);
      }
      if (
        typescript.isCallExpression(node)
        && (
          isDangerousDynamicMemberRead(node.expression)
          || containsDynamicMemberAlias(node.expression)
          || (
            isDynamicMemberFunction(node.expression)
            && node.arguments.some((argument) => (
              containsDomNodeExpression(argument) || containsDynamicMemberAlias(argument)
            ))
          )
          || node.arguments.some((argument) => (
            isDangerousDynamicMemberRead(argument) || containsDynamicMemberAlias(argument)
          ))
        )
      ) {
        issues.push(`${file.path}: browser source may not call through or pass a dynamically derived DOM transport host`);
      }
      if (
        (typescript.isArrayLiteralExpression(node) || typescript.isObjectLiteralExpression(node))
        && containsBrowserGlobalHost(node)
      ) {
        issues.push(`${file.path}: browser source may not package a browser-global transport host`);
      }
      if (
        typescript.isReturnStatement(node)
        && node.expression
        && containsBrowserGlobalHost(node.expression)
      ) {
        issues.push(`${file.path}: browser source may not return a browser-global transport host`);
      }
      if (
        typescript.isThrowStatement(node)
        && node.expression
        && containsBrowserGlobalHost(node.expression)
      ) {
        issues.push(`${file.path}: browser source may not throw a browser-global transport host`);
      }
      if (
        typescript.isYieldExpression(node)
        && node.expression
        && containsBrowserGlobalHost(node.expression)
      ) {
        issues.push(`${file.path}: browser source may not yield a browser-global transport host`);
      }
      if (
        typescript.isParameter(node)
        && node.initializer
        && containsBrowserGlobalHost(node.initializer)
      ) {
        issues.push(`${file.path}: browser source may not use a browser-global transport host as a parameter default`);
      }
      if (
        typescript.isBindingElement(node)
        && node.initializer
        && containsBrowserGlobalHost(node.initializer)
      ) {
        issues.push(`${file.path}: browser source may not use a browser-global transport host as a binding default`);
      }
      if (
        typescript.isPropertyDeclaration(node)
        && node.initializer
        && containsBrowserGlobalHost(node.initializer)
      ) {
        issues.push(`${file.path}: browser source may not store a browser-global transport host in a class property`);
      }
      if (
        typescript.isArrowFunction(node)
        && !typescript.isBlock(node.body)
        && containsBrowserGlobalHost(node.body)
      ) {
        issues.push(`${file.path}: browser source may not return a browser-global transport host`);
      }
      if (
        typescript.isNewExpression(node)
        && node.arguments?.some((argument) => containsBrowserGlobalHost(argument))
      ) {
        issues.push(`${file.path}: browser source may not pass a browser-global transport host to a constructor`);
      }
      if (
        file.path !== 'src/integrations/supabase/types.ts'
        && (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node))
      ) {
        const table = node.text.replace(/^public\./, '');
        if (protectedTables.has(table)) {
          issues.push(`${file.path}: browser source retains protected raw table identifier ${node.text}`);
        }
      }
      if (
        typescript.isIdentifier(node)
        && supabaseNames.has(node.text)
        && !isAllowedSupabaseIdentifier(node)
      ) {
        issues.push(`${file.path}: browser source may use the Supabase singleton only through a direct reviewed member access`);
      }
      if (
        typescript.isImportDeclaration(node)
        && typescript.isStringLiteral(node.moduleSpecifier)
        && node.moduleSpecifier.text === '@supabase/supabase-js'
        && file.path !== 'src/integrations/supabase/client.ts'
        && importsRuntimeSupabaseFactory(node)
      ) {
        issues.push(`${file.path}: browser source may not construct an alternate Supabase client`);
      }
      if (
        typescript.isExportDeclaration(node)
        && file.path !== 'src/integrations/supabase/client.ts'
        && node.moduleSpecifier
        && typescript.isStringLiteral(node.moduleSpecifier)
        && (
          node.moduleSpecifier.text.endsWith('/integrations/supabase/client')
          || node.moduleSpecifier.text === '@supabase/supabase-js'
          || node.moduleSpecifier.text.startsWith('@supabase/supabase-js/')
        )
      ) {
        issues.push(`${file.path}: browser source may not re-export a Supabase client or factory`);
      }
      if (
        typescript.isExportDeclaration(node)
        && file.path !== 'src/integrations/supabase/client.ts'
        && !node.moduleSpecifier
        && node.exportClause
        && typescript.isNamedExports(node.exportClause)
        && node.exportClause.elements.some((element) => (
          supabaseNames.has(element.propertyName?.text ?? element.name.text)
          || (element.propertyName?.text ?? element.name.text) === 'createClient'
        ))
      ) {
        issues.push(`${file.path}: browser source may not re-export a Supabase client or factory`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && isSupabaseRoot(node.expression)
      ) {
        issues.push(`${file.path}: browser source may not use computed Supabase client dispatch`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && isBrowserGlobalExpression(node.expression)
      ) {
        issues.push(`${file.path}: browser source may not use computed global transport dispatch`);
      }
      if (isUnreviewedBrowserSurfaceProperty(node)) {
        issues.push(`${file.path}: browser source may not read an unreviewed global browser surface`);
      }
      if (isCurrentTargetExpression(node) && !isReviewedCurrentTargetUse(node, file)) {
        issues.push(`${file.path}: browser source may not retain an event currentTarget transport host`);
      }
      if (isEventTargetExpression(node) && !isReviewedEventTargetUse(node)) {
        issues.push(`${file.path}: browser source may not retain an event target transport host`);
      }
      if (
        isMessageEventSourceExpression(
          node,
          isMessageEventParameterReference,
          isGlobalMessageEventReference,
        )
      ) {
        issues.push(`${file.path}: browser source may not retain a MessageEvent source transport host`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && browserEventTransportEscapeProperties.has(node.name.text)
      ) {
        issues.push(`${file.path}: browser source may not traverse an event to a transport host`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && browserEventTransportEscapeProperties.has(stringValue(node.argumentExpression) ?? '')
      ) {
        issues.push(`${file.path}: browser source may not traverse an event to a transport host`);
      }
      if (typescript.isIdentifier(node) && dynamicCodeIdentifiers.has(node.text)) {
        issues.push(`${file.path}: browser source may not evaluate dynamically constructed code`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && dynamicCodeIdentifiers.has(node.name.text)
      ) {
        issues.push(`${file.path}: browser source may not evaluate dynamically constructed code`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && dynamicCodeIdentifiers.has(stringValue(node.argumentExpression) ?? '')
      ) {
        issues.push(`${file.path}: browser source may not evaluate dynamically constructed code`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && dynamicCodeEscapeProperties.has(node.name.text)
      ) {
        issues.push(`${file.path}: browser source may not traverse a dynamic-code constructor`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && dynamicCodeEscapeProperties.has(stringValue(node.argumentExpression) ?? '')
      ) {
        issues.push(`${file.path}: browser source may not traverse a dynamic-code constructor`);
      }
      if (
        isDirectFetch(node)
      ) {
        issues.push(`${file.path}: browser source may not access the global fetch transport`);
      }
      if (
        typescript.isIdentifier(node)
        && node.text === 'fetch'
        && (!typescript.isPropertyAccessExpression(node.parent) || node.parent.name !== node)
      ) {
        issues.push(`${file.path}: browser source may not reference the global fetch transport`);
      }
      if (
        typescript.isIdentifier(node)
        && directTransportConstructors.has(node.text)
        && (!typescript.isPropertyAccessExpression(node.parent) || node.parent.name !== node)
      ) {
        issues.push(`${file.path}: browser source may not reference a direct HTTP transport`);
      }
      if (
        typescript.isIdentifier(node)
        && workerConstructors.has(node.text)
        && (!typescript.isNewExpression(node.parent) || node.parent.expression !== node)
      ) {
        issues.push(`${file.path}: browser source may not alias a worker constructor`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && isDirectTransportConstructor(node)
      ) {
        issues.push(`${file.path}: browser source may not access a direct HTTP transport`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && workerConstructors.has(node.name.text)
      ) {
        issues.push(`${file.path}: browser source may not recover a worker constructor from an object`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && node.name.text === 'sendBeacon'
      ) {
        issues.push(`${file.path}: browser source may not access navigator beacon transport`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && node.name.text === 'valueOf'
        && isBrowserGlobalExpression(node.expression)
      ) {
        issues.push(`${file.path}: browser source may not extract a browser-global identity method`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && browserWindowProxyEscapeProperties.has(node.name.text)
      ) {
        issues.push(`${file.path}: browser source may not traverse a DOM node to a WindowProxy host`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && (
          stringValue(node.argumentExpression) === 'fetch'
          || stringValue(node.argumentExpression) === 'sendBeacon'
          || directTransportConstructors.has(stringValue(node.argumentExpression) ?? '')
          || workerConstructors.has(stringValue(node.argumentExpression) ?? '')
        )
      ) {
        issues.push(`${file.path}: browser source may not access a direct HTTP transport through computed dispatch`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && browserWindowProxyEscapeProperties.has(stringValue(node.argumentExpression) ?? '')
      ) {
        issues.push(`${file.path}: browser source may not traverse a DOM node to a WindowProxy host`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && node.name.text === 'from'
        && (!typescript.isCallExpression(node.parent) || node.parent.expression !== node)
      ) {
        issues.push(`${file.path}: browser source may not extract a table-query .from()`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && stringValue(node.argumentExpression) === 'from'
        && (!typescript.isCallExpression(node.parent) || node.parent.expression !== node)
      ) {
        issues.push(`${file.path}: browser source may not extract a table-query .from()`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && node.name.text === 'on'
        && (!typescript.isCallExpression(node.parent) || node.parent.expression !== node)
      ) {
        issues.push(`${file.path}: browser source may not extract an event subscription method`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && stringValue(node.argumentExpression) === 'on'
        && (!typescript.isCallExpression(node.parent) || node.parent.expression !== node)
      ) {
        issues.push(`${file.path}: browser source may not extract an event subscription method`);
      }
      if (
        typescript.isPropertyAccessExpression(node)
        && browserEventRegistrationMethods.has(node.name.text)
        && (!typescript.isCallExpression(node.parent) || node.parent.expression !== node)
      ) {
        issues.push(`${file.path}: browser source may not extract a global event registration method`);
      }
      if (
        typescript.isElementAccessExpression(node)
        && browserEventRegistrationMethods.has(stringValue(node.argumentExpression) ?? '')
        && (!typescript.isCallExpression(node.parent) || node.parent.expression !== node)
      ) {
        issues.push(`${file.path}: browser source may not extract a global event registration method`);
      }
      if (
        typescript.isVariableDeclaration(node)
        && node.initializer
        && isSupabaseRoot(node.initializer)
      ) {
        issues.push(`${file.path}: browser source may not alias the Supabase singleton`);
      }
      if (
        typescript.isVariableDeclaration(node)
        && node.initializer
        && isBrowserGlobalExpression(node.initializer)
      ) {
        issues.push(`${file.path}: browser source may not alias a browser-global transport host`);
      }
      if (
        typescript.isVariableDeclaration(node)
        && node.initializer
        && isDirectTransportConstructor(unwrapExpression(node.initializer))
      ) {
        issues.push(`${file.path}: browser source may not alias a direct HTTP transport`);
      }
      if (
        typescript.isBinaryExpression(node)
        && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
        && isSupabaseRoot(node.right)
      ) {
        issues.push(`${file.path}: browser source may not alias the Supabase singleton`);
      }
      if (
        typescript.isBinaryExpression(node)
        && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
        && isBrowserGlobalExpression(node.right)
      ) {
        issues.push(`${file.path}: browser source may not alias a browser-global transport host`);
      }
      if (
        typescript.isBinaryExpression(node)
        && node.operatorToken.kind === typescript.SyntaxKind.EqualsToken
        && isDirectTransportConstructor(unwrapExpression(node.right))
      ) {
        issues.push(`${file.path}: browser source may not alias a direct HTTP transport`);
      }
      if (typescript.isIdentifier(node) && node.text === 'Reflect') {
        issues.push(`${file.path}: browser source may not use reflection to access a direct transport`);
      }
      if (typescript.isNewExpression(node) && isDirectTransportConstructor(unwrapExpression(node.expression))) {
        issues.push(`${file.path}: browser source may not construct a direct HTTP transport`);
      }
      if (
        typescript.isNewExpression(node)
        && typescript.isIdentifier(node.expression)
        && dynamicMemberAliases.has(node.expression.text)
      ) {
        issues.push(`${file.path}: browser source may not construct through a dynamically computed member`);
      }
      if (
        typescript.isNewExpression(node)
        && typescript.isElementAccessExpression(unwrapExpression(node.expression))
        && stringValue(unwrapExpression(node.expression).argumentExpression) === null
      ) {
        issues.push(`${file.path}: browser source may not construct through a dynamically computed member`);
      }
      if (
        typescript.isNewExpression(node)
        && typescript.isIdentifier(node.expression)
        && ['Worker', 'SharedWorker'].includes(node.expression.text)
      ) {
        const entrypoint = node.arguments?.[0] ? unwrapExpression(node.arguments[0]) : null;
        const isStaticLocalString = Boolean(
          entrypoint
          && stringValue(entrypoint)
          && !/^(?:data|blob|https?):/i.test(stringValue(entrypoint))
        );
        const isStaticLocalUrl = Boolean(
          entrypoint
          && typescript.isNewExpression(entrypoint)
          && typescript.isIdentifier(entrypoint.expression)
          && entrypoint.expression.text === 'URL'
          && entrypoint.arguments?.[0]
          && stringValue(entrypoint.arguments[0])
          && !/^(?:data|blob|https?):/i.test(stringValue(entrypoint.arguments[0]))
        );
        if (!isStaticLocalString && !isStaticLocalUrl) {
          issues.push(`${file.path}: browser workers must use a static local reviewed entrypoint`);
        }
      }
      if (!typescript.isCallExpression(node)) {
        typescript.forEachChild(node, visit);
        return;
      }
      const { method, receiver } = callTarget(node, sourceFile);
      const eventName = stringValue(node.arguments[0]);
      if (
        isGlobalEventListenerCall(node)
        && (eventName === null || eventName === 'message')
      ) {
        issues.push(`${file.path}: browser source may not register a dynamic or message global event handler`);
      }
      if (node.arguments.some((argument) => containsBrowserGlobalHost(argument))) {
        issues.push(`${file.path}: browser source may not pass a browser-global transport host to a function`);
      }
      if (typescript.isElementAccessExpression(node.expression)) {
        issues.push(`${file.path}: browser source may not use computed method dispatch`);
      }
      if (isDirectFetch(node.expression)) {
        issues.push(`${file.path}: browser source may not issue direct fetch requests`);
      }
      if (
        typescript.isIdentifier(node.expression)
        && dynamicMemberAliases.has(node.expression.text)
      ) {
        issues.push(`${file.path}: browser source may not call a dynamically computed member`);
      }
      if (typescript.isIdentifier(node.expression) && node.expression.text === 'require') {
        issues.push(`${file.path}: browser source may not dynamically require a data transport`);
      }
      if (typescript.isIdentifier(node.expression) && node.expression.text === 'importScripts') {
        issues.push(`${file.path}: browser source may not dynamically import worker code`);
      }
      if (
        typescript.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'sendBeacon'
      ) {
        issues.push(`${file.path}: browser source may not issue direct navigator beacon requests`);
      }
      if (
        node.expression.kind === typescript.SyntaxKind.ImportKeyword
        && (
          !stringValue(node.arguments[0])
          || stringValue(node.arguments[0]) === '@supabase/supabase-js'
          || stringValue(node.arguments[0]).startsWith('@supabase/supabase-js/')
          || stringValue(node.arguments[0]).includes('integrations/supabase/client')
          || isBrowserTransportModule(stringValue(node.arguments[0]))
          || /^(?:data|blob|https?):/i.test(stringValue(node.arguments[0]))
        )
      ) {
        issues.push(`${file.path}: browser source may not dynamically import a direct data transport`);
      }
      if (isDirectSupabaseDispatch(node) && !['channel', 'from', 'removeChannel'].includes(method)) {
        issues.push(`${file.path}: browser source may call only reviewed direct Supabase methods`);
      }
      if (isDirectSupabaseDispatch(node) && method === 'channel' && eventName === null) {
        issues.push(`${file.path}: browser Supabase channels must use static reviewed names`);
      }
      const isPotentialRealtimeDispatch = (
        (method === 'on' || method === null)
        && (receiver === 'channel' || receiver?.includes('.channel('))
      );
      if (method === 'on' && eventName === null) {
        issues.push(`${file.path}: browser event subscriptions must use static event names`);
      }
      if (method === 'from' && receiver !== 'Array' && !receiver?.endsWith('.storage')) {
        const value = stringValue(node.arguments[0]);
        if (value === null) {
          issues.push(`${file.path}: browser .from() target must be a static reviewed literal`);
        } else if (protectedTables.has(value.replace(/^public\./, ''))) {
          issues.push(`${file.path}: browser .from() targets protected raw table ${value}`);
        }
      }
      const config = node.arguments[1];
      const isPostgresChanges = method === 'on' && eventName === 'postgres_changes';
      if (isPotentialRealtimeDispatch && (method !== 'on' || eventName === null)) {
        issues.push(`${file.path}: Realtime channel dispatch must use literal .on('postgres_changes', ...) syntax`);
      }
      if (
        isPostgresChanges
        && (!config || !typescript.isObjectLiteralExpression(config))
      ) {
        issues.push(`${file.path}: postgres_changes config must be a static object`);
      }
      const tableProperty = config && typescript.isObjectLiteralExpression(config)
        ? config.properties.find((property) => (
          (typescript.isPropertyAssignment(property) || typescript.isShorthandPropertyAssignment(property))
          && propertyName(property) === 'table'
        ))
        : null;
      const tableExpression = tableProperty && typescript.isPropertyAssignment(tableProperty)
        ? tableProperty.initializer
        : tableProperty && typescript.isShorthandPropertyAssignment(tableProperty)
          ? tableProperty.name
          : null;
      if (isPostgresChanges && typescript.isObjectLiteralExpression(config)) {
        if (config.properties.some((property) => typescript.isSpreadAssignment(property))) {
          issues.push(`${file.path}: postgres_changes config may not use spread properties`);
        }
        if (!tableProperty) {
          issues.push(`${file.path}: postgres_changes config must declare an explicit reviewed table`);
        }
      }
      if (tableProperty) {
        if (method !== 'on' || eventName !== 'postgres_changes') {
          issues.push(`${file.path}: Realtime table subscriptions must use literal .on('postgres_changes', ...) dispatch`);
        } else {
          const value = tableExpression ? stringValue(tableExpression) : null;
          if (value === null) {
            if (!tableExpression || !isCanonicalMonitoringRealtimeTable(file, tableExpression)) {
              issues.push(`${file.path}: postgres_changes table must be a static reviewed literal or the reviewed monitoring table iterator`);
            }
          } else if (protectedTables.has(value.replace(/^public\./, ''))) {
            issues.push(`${file.path}: postgres_changes targets protected raw table ${value}`);
          }
        }
      }
      typescript.forEachChild(node, visit);
    };
    visit(sourceFile);
    sourceFileIssueCache.set(file, {
      path: file.path,
      source: file.source,
      documentBaseHref: file.documentBaseHref,
      staticHtmlConfigurationValue: file.staticHtmlConfigurationValue,
      staticHtmlResolvedResourceUrl: file.staticHtmlResolvedResourceUrl,
      staticHtmlResourceUrl: file.staticHtmlResourceUrl,
      issues: issues.slice(issueStart),
    });
  }
  return issues;
}

function validate({
  migration,
  videoPipeline,
  manualIntakes,
  feedbackRevision,
  rendererConfig,
  renderer,
  adminActions,
  adminClient,
  monitoringRealtime,
  frontendFiles,
  newerRelevantMigrations,
  postLockdownMigrations,
}) {
  validatePostLockdownMigrations(postLockdownMigrations);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;\s*$/, 'lockdown must be a transactional forward migration');
  assert.doesNotMatch(migration, /auth\.uid\(\)\s+IS\s+NOT\s+NULL/i, 'lockdown may not restore broad authenticated RLS');
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)\s+ON\s+(?:TABLE\s+)?public\.(?:video_renders|video_render_feedback|video_renderer_heartbeats|manual_video_intakes)\s+TO\s+(?:PUBLIC|anon|authenticated)\b/i,
    'lockdown may not grant raw table access to a browser role',
  );
  assert.doesNotMatch(
    migration,
    /ALTER\s+TABLE\s+public\.(?:video_renders|video_render_feedback|video_renderer_heartbeats|manual_video_intakes)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/i,
    'lockdown may not disable RLS for a protected raw table',
  );
  assert.doesNotMatch(
    migration,
    /\b(?:DO|EXECUTE|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|ALTER\s+DEFAULT\s+PRIVILEGES)\b/i,
    'the narrow RLS lockdown may not introduce dynamic SQL or default-privilege changes',
  );
  assert.deepEqual(
    executableSqlStatements(migration),
    expectedLockdownStatements(),
    'lockdown executable SQL must remain exactly the reviewed four-table service-only policy transition',
  );
  assert.equal(
    newerRelevantMigrations.length,
    0,
    `newer raw-table migration(s) require this contract to be reviewed: ${newerRelevantMigrations.join(', ')}`,
  );

  for (const contract of tables) {
    const block = tableBlock(migration, contract.table);
    const escapedTable = contract.table.replace(/_/g, '\\_');
    assert.match(
      block,
      new RegExp(`ALTER TABLE public\\.${escapedTable}\\s+ENABLE ROW LEVEL SECURITY;`),
      `${contract.table} must keep RLS enabled`,
    );
    for (const policy of contract.legacyPolicies) {
      assert.match(
        block,
        new RegExp(`DROP POLICY IF EXISTS "${policy}" ON public\\.${escapedTable};`),
        `${contract.table} must remove legacy policy ${policy}`,
      );
    }
    assert.match(
      block,
      new RegExp(`REVOKE ALL ON TABLE public\\.${escapedTable} FROM PUBLIC, anon, authenticated;`),
      `${contract.table} must revoke all browser-role privileges`,
    );
    assert.match(
      block,
      new RegExp(`GRANT ALL ON TABLE public\\.${escapedTable} TO service_role;`),
      `${contract.table} must preserve only service-role table access`,
    );
    const grants = (block.match(/\bGRANT\b[\s\S]*?;/gi) ?? []).map(normalizeSqlWhitespace);
    assert.deepEqual(
      grants,
      [`GRANT ALL ON TABLE public.${contract.table} TO service_role;`],
      `${contract.table} may grant raw-table privileges only to service_role`,
    );
    const policies = block.match(/CREATE POLICY[\s\S]*?;/gi) ?? [];
    assert.equal(
      policies.length,
      1,
      `${contract.table} must define exactly one service-role-only policy`,
    );
    assert.match(
      policies[0],
      new RegExp(
        `CREATE POLICY "${contract.servicePolicy}"\\s+ON public\\.${escapedTable}\\s+FOR ALL\\s+TO service_role\\s+USING \\(\\(SELECT auth\\.role\\(\\)\\) = 'service_role'\\)\\s+WITH CHECK \\(\\(SELECT auth\\.role\\(\\)\\) = 'service_role'\\);`,
      ),
      `${contract.table} must retain the cached service-role-only RLS policy`,
    );
  }

  assert.match(
    adminClient,
    /supabase\.functions\.invoke\('admin-actions', \{ body \}\)/,
    'the browser must retain the canonical admin-actions boundary',
  );
  const authGuardIndex = adminActions.indexOf('const authResult = await requireAdmin(req, corsHeaders);');
  const protectedServiceClientIndex = adminActions.indexOf('const supabase = createClient<any, any>(');
  assert.ok(authGuardIndex >= 0, 'admin-actions must require an authenticated admin before dispatch');
  assert.ok(protectedServiceClientIndex >= 0, 'admin-actions must construct its dispatch service client explicitly');
  assert.ok(authGuardIndex < protectedServiceClientIndex, 'admin-actions must authorize before the raw-table service client is constructed');
  assert.match(
    rendererConfig,
    /const required = \["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"\];/,
    'the renderer must require a service-role credential rather than a browser key',
  );
  assert.match(
    renderer,
    /createClient\(config\.supabaseUrl, config\.supabaseServiceRoleKey,/,
    'the renderer must construct its Supabase client with the service-role credential',
  );
  assert.deepEqual(
    exportedStringArray(monitoringRealtime, 'src/lib/monitoringRealtime.ts', 'MONITORING_REALTIME_TABLES'),
    expectedMonitoringRealtimeTables,
    'the only reviewed dynamic browser Realtime table source must remain the finite non-video monitoring allowlist',
  );

  const rpcSources = { videoPipeline, manualIntakes, feedbackRevision };
  for (const [sourceName, signature] of serviceOnlyRpcs) {
    const source = rpcSources[sourceName];
    const compactSource = compactSql(source);
    const compactSignature = compactSql(signature);
    assert.ok(
      compactSource.includes(`revokeallonfunction${compactSignature}frompublic,anon,authenticated;`),
      `${signature} must revoke browser-role execution`,
    );
    assert.deepEqual(
      directFunctionGrantStatements(source, signature).map(compactSql),
      [compactSql(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`)],
      `${signature} may grant only the exact service-role EXECUTE statement`,
    );
  }
  for (const [sourceName, source] of Object.entries(rpcSources)) {
    assert.equal(
      browserSchemaFunctionGrant(source),
      false,
      `${sourceName} may not grant execution on all functions in any schema`,
    );
    assert.ok(
      functionGrantStatements(source).every(isServiceOnlyFunctionGrant),
      `${sourceName} may grant function execution only with direct service-role EXECUTE statements`,
    );
    assert.equal(
      hasDynamicSqlBlock(source),
      false,
      `${sourceName} may not introduce dynamic SQL blocks into the reviewed RPC migration`,
    );
  }

  for (const contract of tables) {
    for (const action of contract.actions) {
      assert.match(
        adminActions,
        new RegExp(`case '${action}'`),
        `${contract.table} must retain its canonical admin action ${action}`,
      );
    }
  }
  assert.deepEqual(
    sourceFileIssues(frontendFiles),
    [],
    'browser source must not bypass the admin-actions boundary for protected raw tables',
  );
}

const migrationsDirectory = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const reviewedNonRawMigrationDigests = new Map([
  // E10 owns the canonical role/runtime-control surface. It is reviewed by
  // the role-auth and E10 contracts, not by this video raw-table lockdown.
  ['20260812100000_e10_preview_runtime_controls_and_roles.sql', '66729659d4573d1245ba3ee7845fb76fa7808ecb5bda74cb616916e0700518d7'],
  // This caller-bound, read-only role helper is reviewed by SR-AUTH-01. Keep
  // the exemption byte-locked so any future edit re-enters this RLS review.
  ['20260724183000_add_current_user_is_admin_rpc.sql', 'cedd28e0976f70bdff25ac2e3025c407fb27af4beff1d3ebc14f888be8a08602'],
]);

const protectedAccessIdentifierPattern = new RegExp(
  `\\b(?:${[
    ...tables.map(({ table }) => table),
    ...serviceOnlyRpcs.map(([, signature]) => compactSql(signature).match(/^public\.([a-z_][a-z0-9_]*)\(/)?.[1]),
  ].filter(Boolean).map(escapeRegExp).join('|')})\\b`,
  'i',
);

function decodeUnicodeSqlIdentifiers(source) {
  return source.replace(/\bU&"((?:""|[^"])*)"/gi, (_match, identifier) => (
    identifier
      .replace(/\\(?:\+([0-9a-f]{6})|([0-9a-f]{4}))/gi, (_escape, longCodePoint, shortCodePoint) => {
        const codePoint = Number.parseInt(longCodePoint ?? shortCodePoint, 16);
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return _escape;
        }
      })
      .replaceAll('""', '"')
  ));
}

function normalizedMigrationAccessSource(source) {
  return decodeUnicodeSqlIdentifiers(executableSqlStatements(source).join('\n'))
    .replace(/"([a-z_][a-z0-9_]*)"/gi, '$1')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function hasBrowserFunctionGrant(source) {
  return functionGrantStatements(source).some((statement) => {
    const target = normalizeSqlWhitespace(statement).match(/\bTO\s+(.+?);$/i)?.[1] ?? '';
    return /\b(?:public|anon|authenticated)\b/i.test(target);
  });
}

function hasBrowserRoleMembershipGrant(source) {
  return executableSqlStatements(source).some((statement) => (
    /^GRANT\s+(?:ROLE\s+)?(?:[a-z_][a-z0-9_$]*|"[^"]+")(?:\s*,\s*(?:[a-z_][a-z0-9_$]*|"[^"]+"))*\s+TO\s+(?:GROUP\s+)?(?:public|anon|authenticated)\b/i
      .test(normalizedMigrationAccessSource(statement))
  ));
}

function isReviewedNonRawMigration(name, source) {
  const expectedDigest = name ? reviewedNonRawMigrationDigests.get(name) : null;
  return Boolean(
    expectedDigest
    && createHash('sha256').update(source).digest('hex') === expectedDigest,
  );
}

function isExactPostLockdownMigration(name, source) {
  const expectedDigest = name ? postLockdownMigrationDigests.get(name) : null;
  return Boolean(
    expectedDigest
      && createHash('sha256').update(source).digest('hex') === expectedDigest,
  );
}

function migrationTouchesProtectedAccessSurface(source, name = null) {
  if (isReviewedNonRawMigration(name, source) || isExactPostLockdownMigration(name, source)) return false;
  const normalized = normalizedMigrationAccessSource(source);
  if (!normalized) return false;

  // Direct raw-table and renderer-RPC changes always require this contract to
  // be reviewed, regardless of whether the SQL is a grant, RLS policy, data
  // statement, or function body reference.
  if (protectedAccessIdentifierPattern.test(normalized)) return true;

  // A role-membership grant, role/default-privilege mutation, browser-callable
  // function, SECURITY DEFINER/role context, or dynamic SQL can change access
  // without naming a protected table in a form this static contract can prove safe.
  if (/\b(?:alter|create)\s+role\b|\balter\s+default\s+privileges\b/i.test(normalized)) return true;
  if (hasBrowserRoleMembershipGrant(source)) return true;
  if (hasBrowserFunctionGrant(source)) return true;
  if (/\bsecurity\s+definer\b|\bset\s+(?:local\s+)?role\b|\balter\s+function\b/i.test(normalized)) return true;
  if (/\bdo\b|\bexecute\s+(?:'|\$|format\s*\()/i.test(normalized)) return true;

  // Schema-wide browser grants can expose protected RPCs/tables without
  // spelling them out. Preserve the gate for quoted and Unicode-escaped
  // public schemas, but allow unrelated caller-bound RPC migrations through.
  return /\b(?:grant|revoke)\b[\s\S]*?\bon\s+all\s+(?:tables|functions)\s+in\s+schema\s+[^;]*?\bpublic\b[\s\S]*?\bto\s+(?:group\s+)?(?:public|anon|authenticated)\b/i.test(normalized);
}
const newerRelevantMigrations = migrationFiles
  .filter((name) => name > migrationName)
  .filter((name) => migrationTouchesProtectedAccessSurface(read(join(migrationsDirectory, name)), name));

const sources = {
  migration: read(migrationPath),
  videoPipeline: read(videoPipelinePath),
  manualIntakes: read(manualIntakesPath),
  feedbackRevision: read(feedbackRevisionPath),
  rendererConfig: read(rendererConfigPath),
  renderer: read(rendererPath),
  adminActions: read(adminActionsPath),
  adminClient: read(adminClientPath),
  monitoringRealtime: read(monitoringRealtimePath),
  frontendFiles: browserSourceFiles(),
  newerRelevantMigrations,
  postLockdownMigrations: new Map(
    [...postLockdownMigrationDigests.keys()].map((name) => [
      name,
      read(join(migrationsDirectory, name)),
    ]),
  ),
};

validate(sources);

let selfTest = 'skipped';
if (process.env.MUTATION_TEST === '1') {
  const expectRejected = (label, mutate) => {
    assert.throws(
      () => validate(mutate(sources)),
      (error) => error instanceof assert.AssertionError,
      `${label} mutation must fail the source contract`,
    );
  };
  const mutateSuccessor = (source, name, mutate) => {
    const migrations = new Map(source.postLockdownMigrations);
    migrations.set(name, mutate(migrations.get(name)));
    return { ...source, postLockdownMigrations: migrations };
  };
  const mutateE7 = (source, mutate) => {
    const original = source.postLockdownMigrations.get(e7MigrationName);
    const updated = mutate(original);
    assert.notEqual(updated, original, 'E7 mutation must change migration source');
    return mutateSuccessor(source, e7MigrationName, () => updated);
  };
  expectRejected('post-lockdown SHA drift', (source) => mutateSuccessor(
    source,
    '20260730070000_telegram_delivery_claims.sql',
    (migration) => `${migration}\n`,
  ));
  expectRejected('post-lockdown weak search_path', (source) => mutateSuccessor(
    source,
    '20260730070000_telegram_delivery_claims.sql',
    (migration) => migration.replace('SET search_path TO public, pg_catalog', 'SET search_path TO public'),
  ));
  expectRejected('post-lockdown widened function grant', (source) => mutateSuccessor(
    source,
    '20260730070000_telegram_delivery_claims.sql',
    (migration) => migration.replace(
      'GRANT EXECUTE ON FUNCTION public.claim_telegram_delivery(text, text, text, text, integer) TO service_role;',
      'GRANT EXECUTE ON FUNCTION public.claim_telegram_delivery(text, text, text, text, integer) TO authenticated;',
    ),
  ));
  expectRejected('post-lockdown missing function revoke', (source) => mutateSuccessor(
    source,
    '20260730070000_telegram_delivery_claims.sql',
    (migration) => migration.replace(
      'REVOKE ALL ON FUNCTION public.claim_telegram_delivery(text, text, text, text, integer) FROM public, anon, authenticated;\n',
      '',
    ),
  ));
  expectRejected('B4 terminal generation fence removal', (source) => mutateSuccessor(
    source,
    '20260808123000_b4_video_render_claim_fencing.sql',
    (migration) => migration.replaceAll('AND claim_generation = p_claim_generation', ''),
  ));
  expectRejected('B2B UUID guard weakening', (source) => mutateSuccessor(
    source,
    '20260808133000_b2b_media_object_deletion_token_uuid.sql',
    (migration) => migration.replace("^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$", '^[0-9a-f-]+$'),
  ));
  expectRejected('B2B UUID cast weakening', (source) => mutateSuccessor(
    source,
    '20260808133000_b2b_media_object_deletion_token_uuid.sql',
    (migration) => migration.replace('USING deletion_token::uuid', 'USING deletion_token::text'),
  ));
  expectRejected('E7 controllable-owner check removed', (source) => mutateE7(
    source,
    (migration) => migration.replace(
      "IF pg_has_role(current_user, owner_name, 'USAGE') THEN",
      'IF true THEN',
    ),
  ));
  expectRejected('E7 provider exception widened', (source) => mutateE7(
    source,
    (migration) => migration.replace(
      "ELSIF owner_name = 'supabase_admin' THEN",
      "ELSIF owner_name IN ('supabase_admin', 'postgres') THEN",
    ),
  ));
  expectRejected('E7 arbitrary owner failure hidden', (source) => mutateE7(
    source,
    (migration) => migration.replace(
      "RAISE EXCEPTION 'E7 cannot control browser default ACL owner: %', owner_name",
      "RAISE NOTICE 'E7 cannot control browser default ACL owner: %', owner_name",
    ),
  ));
  expectRejected('E7 unsupported residual check removed', (source) => mutateE7(
    source,
    (migration) => migration.replace('unsupported_owner_count <> 0', 'false'),
  ));
  expectRejected('E7 controllable residual check removed', (source) => mutateE7(
    source,
    (migration) => migration.replace('controllable_count <> 0', 'false'),
  ));
  expectRejected('E7 provider residual filter widened', (source) => mutateE7(
    source,
    (migration) => migration.replace(
      "owner_role.rolname <> 'supabase_admin'",
      "owner_role.rolname <> 'postgres'",
    ),
  ));
  expectRejected('E7 hardcoded owner clause', (source) => mutateE7(
    source,
    (migration) => migration.replaceAll('FOR ROLE %I IN SCHEMA public', 'FOR ROLE postgres IN SCHEMA public'),
  ));
  expectRejected('E7 public schema widened', (source) => mutateE7(
    source,
    (migration) => migration.replaceAll("target_schema.nspname = 'public'", 'true'),
  ));
  expectRejected('E7 missing tables revoke', (source) => mutateE7(
    source,
    (migration) => migration.replace('ON TABLES FROM PUBLIC, anon, authenticated;', 'ON TABLES FROM PUBLIC, anon;'),
  ));
  expectRejected('E7 missing sequences revoke', (source) => mutateE7(
    source,
    (migration) => migration.replace('ON SEQUENCES FROM PUBLIC, anon, authenticated;', 'ON SEQUENCES FROM PUBLIC, anon;'),
  ));
  expectRejected('E7 missing functions revoke', (source) => mutateE7(
    source,
    (migration) => migration.replace('ON FUNCTIONS FROM PUBLIC, anon, authenticated;', 'ON FUNCTIONS FROM PUBLIC, anon;'),
  ));
  expectRejected('E7 missing browser grantee', (source) => mutateE7(
    source,
    (migration) => migration.replaceAll("grantee_role.rolname IN ('anon', 'authenticated')", "grantee_role.rolname IN ('anon')"),
  ));
  expectRejected('E7 unsafe owner format', (source) => mutateE7(
    source,
    (migration) => migration.replace("FOR ROLE %I IN SCHEMA public", "FOR ROLE %s IN SCHEMA public"),
  ));
  expectRejected('E7 missing residual raise', (source) => mutateE7(
    source,
    (migration) => migration.replace('RAISE EXCEPTION', 'RAISE NOTICE'),
  ));
  expectRejected('E7 unbounded residual diagnostics', (source) => mutateE7(
    source,
    (migration) => migration.replace('         LIMIT 20\n      ) AS offending;', '      ) AS offending;'),
  ));
  expectRejected('E7 aggregate-level diagnostic ordering removed', (source) => mutateE7(
    source,
    (migration) => migration.replace(
      '      ORDER BY owner_id, objtype, grantee_name, privilege_type, is_grantable\n',
      '',
    ),
  ));
  expectRejected('E7 aggregate-level diagnostic ordering weakened', (source) => mutateE7(
    source,
    (migration) => migration.replace(
      '      ORDER BY owner_id, objtype, grantee_name, privilege_type, is_grantable',
      '      ORDER BY owner_id',
    ),
  ));
  expectRejected('E7 second diagnostic aggregate missing ordering', (source) => mutateE7(
    source,
    (migration) => migration.replace(
      '    SELECT string_agg(\n',
      "    SELECT string_agg('un-ordered diagnostic', ' | ');\n    SELECT string_agg(\n",
    ),
  ));
  expectRejected('E7 uncapped diagnostic output', (source) => mutateE7(
    source,
    (migration) => migration.replace(
      "left(COALESCE(offending_details, '<none>'), 2000)",
      'offending_details',
    ),
  ));
  expectRejected('authenticated table grant', (source) => ({
    ...source,
    migration: source.migration.replace(
      'REVOKE ALL ON TABLE public.video_renders FROM PUBLIC, anon, authenticated;',
      'GRANT SELECT ON TABLE public.video_renders TO authenticated;',
    ),
  }));
  expectRejected('authenticated RLS policy', (source) => ({
    ...source,
    migration: source.migration.replace(
      `TO service_role\n  USING ((SELECT auth.role()) = 'service_role')`,
      `TO authenticated\n  USING (auth.uid() IS NOT NULL)`,
    ),
  }));
  expectRejected('optional-table anon backdoor', (source) => ({
    ...source,
    migration: source.migration.replace(
      '\nCOMMIT;',
      '\nGRANT SELECT ON public.video_renders TO anon;\nCREATE POLICY "anon raw" ON public.video_renders FOR SELECT TO anon USING (true);\n\nCOMMIT;',
    ),
  }));
  expectRejected('comment-obscured final browser ACL', (source) => ({
    ...source,
    migration: source.migration.replace(
      '\nCOMMIT;',
      '\n-- boundary\n/*pre*/ GRANT/*mid*/ SELECT ON TABLE public.video_renders TO authenticated;\n/*pre*/ CREATE/*mid*/ POLICY "browser raw" ON public.video_renders FOR SELECT TO authenticated USING (true);\nCOMMIT;',
    ),
  }));
  expectRejected('protected table ownership transfer', (source) => ({
    ...source,
    migration: source.migration.replace(
      '\nCOMMIT;',
      '\nALTER TABLE public.video_renders OWNER TO authenticated;\nCOMMIT;',
    ),
  }));
  expectRejected('pre-section browser schema grant and policy', (source) => ({
    ...source,
    migration: source.migration.replace(
      'BEGIN;\n\n-- video_renders',
      'BEGIN;\n\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO PUBLIC;\nCREATE POLICY "Public raw video renders" ON public.video_renders FOR SELECT TO PUBLIC USING (true);\n\n-- video_renders',
    ),
  }));
  expectRejected('dynamic SQL privilege backdoor', (source) => ({
    ...source,
    migration: source.migration.replace(
      'BEGIN;\n\n-- video_renders',
      "BEGIN;\n\nDO $$ BEGIN EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO PUBLIC'; END $$;\n\n-- video_renders",
    ),
  }));
  expectRejected('additional browser RLS policy', (source) => ({
    ...source,
    migration: source.migration.replace(
      "  WITH CHECK ((SELECT auth.role()) = 'service_role');\n\n-- video_render_feedback",
      "  WITH CHECK ((SELECT auth.role()) = 'service_role');\n\nCREATE POLICY \"Public raw video renders\" ON public.video_renders FOR SELECT TO PUBLIC USING (true);\n\n-- video_render_feedback",
    ),
  }));
  expectRejected('generic browser raw query', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-generic-query.ts', source: `const bypass = supabase.from<Row>('video_renders');` },
    ],
  }));
  expectRejected('computed browser raw query', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-computed-query.ts', source: `const rawTable = ['video', 'renders'].join('_'); supabase.from(rawTable);` },
    ],
  }));
  expectRejected('element-access browser raw query', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-element-query.ts', source: `const rawTable = ['video', 'renders'].join('_'); supabase['from'](rawTable);` },
    ],
  }));
  expectRejected('computed Supabase method raw query', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-computed-method-query.ts', source: `const method = ['fr', 'om'].join(''); const rawTable = ['video', 'renders'].join('_'); supabase[method](rawTable);` },
    ],
  }));
  expectRejected('type-cast computed Supabase method raw query', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-cast-method-query.ts', source: `const method = ['fr', 'om'].join(''); const rawTable = ['video', 'renders'].join('_'); (supabase as unknown as Record<string, Function>)[method](rawTable);` },
    ],
  }));
  expectRejected('JavaScript browser raw query', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-browser-query.js', source: `supabase.from('video_renders');` },
    ],
  }));
  expectRejected('direct browser PostgREST endpoint', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-rest-query.ts', source: `fetch('/rest/v1/video_renders');` },
    ],
  }));
  expectRejected('constructed browser PostgREST endpoint', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-constructed-rest-query.ts', source: `const rawTable = ['video', 'renders'].join('_'); fetch('/rest' + '/v1/' + rawTable);` },
    ],
  }));
  expectRejected('Location href raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-location-href-rest-navigation.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); globalThis.location.href = endpoint;` },
    ],
  }));
  expectRejected('Location assign raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-location-assign-rest-navigation.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); globalThis.location.assign(endpoint);` },
    ],
  }));
  expectRejected('Location replace raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-location-replace-rest-navigation.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); window.location.replace(endpoint);` },
    ],
  }));
  expectRejected('computed Location raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-location-computed-rest-navigation.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const method = ['as', 'sign'].join(''); globalThis.location[method](endpoint);` },
    ],
  }));
  expectRejected('Location root raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-location-root-rest-navigation.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); window.location = endpoint;` },
    ],
  }));
  expectRejected('JSX iframe raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-jsx-iframe-rest-resource.tsx', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); export const RawEndpointFrame = () => <iframe src={endpoint} />;` },
    ],
  }));
  expectRejected('JSX srcSet raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-jsx-src-set-rest-resource.tsx', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); export const RawEndpointImage = () => <img srcSet={endpoint} />;` },
    ],
  }));
  expectRejected('DOM srcSet raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-dom-src-set-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const image = document.createElement('img'); image.srcSet = endpoint;` },
    ],
  }));
  expectRejected('Object.assign raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-object-assign-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const image = document.createElement('img'); Object.assign(image, { src: endpoint });` },
    ],
  }));
  expectRejected('aliased Object.assign raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-aliased-object-assign-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const image = document.createElement('img'); const assign = Object.assign; assign(image, { src: endpoint });` },
    ],
  }));
  expectRejected('parameter-laundered raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-parameter-laundered-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const image = document.createElement('img'); function load(target: HTMLImageElement, url: string) { target.src = url; } load(image, endpoint);` },
    ],
  }));
  expectRejected('constructor-laundered raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-constructor-laundered-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); class Loader { constructor(url: string) { const image = document.createElement('img'); image.src = url; } } new Loader(endpoint);` },
    ],
  }));
  expectRejected('tagged-template-laundered raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-tagged-template-laundered-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); function load(strings: TemplateStringsArray, url: string) { const image = document.createElement('img'); image.src = url; } load\`endpoint=\${endpoint}\`;` },
    ],
  }));
  expectRejected('JSX component-prop-laundered raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-jsx-component-prop-laundered-rest-resource.tsx', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); function Resource({ url }: { url: string }) { return <img src={url} />; } export function App() { return <Resource url={endpoint} />; }` },
    ],
  }));
  expectRejected('JSX component-spread-prop-laundered raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-jsx-component-spread-prop-laundered-rest-resource.tsx', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); function Resource({ url }: { url: string }) { return <img src={url} />; } export const App = () => <Resource {...{ url: endpoint }} />;` },
    ],
  }));
  expectRejected('aliased JSX component-spread-prop raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-aliased-jsx-component-spread-prop-rest-resource.tsx', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const props = { url: endpoint }; function Resource({ url }: { url: string }) { return <img src={url} />; } export const App = () => <Resource {...props} />;` },
    ],
  }));
  expectRejected('JSX component-child-laundered raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-jsx-component-child-laundered-rest-resource.tsx', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); function Resource({ children }: { children: string }) { return <img src={children} />; } export const App = () => <Resource>{endpoint}</Resource>;` },
    ],
  }));
  expectRejected('defaulted JSX component-prop raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-defaulted-jsx-component-prop-rest-resource.tsx', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); function Resource({ url = endpoint }: { url?: string }) { return <img src={url} />; } export const App = () => <Resource />;` },
    ],
  }));
  expectRejected('custom-setter-laundered raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-custom-setter-laundered-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); class Carrier { constructor(private image: HTMLImageElement) {} set url(value: string) { this.image.src = value; } } const image = document.createElement('img'); const carrier = new Carrier(image); carrier.url = endpoint;` },
    ],
  }));
  expectRejected('character-code-encoded raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-character-code-encoded-rest-resource.ts', source: `const suffix = String.fromCharCode(47, 114, 101, 115, 116, 47, 118, 49, 47, 112, 111, 115, 116, 115); const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + suffix; const image = document.createElement('img'); image.src = endpoint;` },
    ],
  }));
  expectRejected('spread character-code-encoded raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-spread-character-code-encoded-rest-resource.ts', source: `const suffix = String.fromCharCode(...[47, 114, 101, 115, 116, 47, 118, 49, 47, 112, 111, 115, 116, 115]); const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + suffix; const image = document.createElement('img'); image.src = endpoint;` },
    ],
  }));
  expectRejected('indirect character-code decoder raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-indirect-character-code-decoder-rest-resource.ts', source: `const codes = [47, 114, 101, 115, 116, 47, 118, 49, 47, 112, 111, 115, 116, 115]; const suffix = String.fromCharCode.apply(null, codes); const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + suffix; const image = document.createElement('img'); image.src = endpoint;` },
    ],
  }));
  expectRejected('percent-decoded raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-percent-decoded-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + decodeURIComponent('%2F%72%65%73%74%2F%76%31%2Fposts'); const image = document.createElement('img'); image.src = endpoint;` },
    ],
  }));
  expectRejected('base64-decoded raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-base64-decoded-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + atob('L3Jlc3QvdjEvcG9zdHM='); const image = document.createElement('img'); image.src = endpoint;` },
    ],
  }));
  expectRejected('JSON-unicode-decoded raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-json-unicode-decoded-rest-resource.ts', source: `const suffix = JSON.parse('"\\u002f\\u0072\\u0065\\u0073\\u0074\\u002f\\u0076\\u0031\\u002fposts"'); const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + suffix; const image = document.createElement('img'); image.src = endpoint;` },
    ],
  }));
  expectRejected('hard-coded Supabase-base encoded raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-hard-coded-supabase-base-rest-resource.ts', source: `const suffix = JSON.parse('"\\u002f\\u0072\\u0065\\u0073\\u0074\\u002f\\u0076\\u0031\\u002fposts"'); const endpoint = 'https://project.supabase.co' + suffix; const image = document.createElement('img'); image.src = endpoint;` },
    ],
  }));
  expectRejected('JSON-unicode-encoded Supabase-base raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-json-unicode-encoded-supabase-base-rest-resource.ts', source: `const endpoint = JSON.parse('"https:\\\\u002f\\\\u002fproject\\\\u002esupabase\\\\u002eco\\\\u002f\\\\u0072\\\\u0065\\\\u0073\\\\u0074\\\\u002f\\\\u0076\\\\u0031\\\\u002fposts"'); const image = document.createElement('img'); image.src = endpoint;` },
    ],
  }));
  expectRejected('UTF-8-decoded raw Supabase PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-utf8-decoded-supabase-rest-resource.ts', source: `const endpoint = new TextDecoder().decode(new Uint8Array([104, 116, 116, 112, 115, 58, 47, 47, 112, 114, 111, 106, 101, 99, 116, 46, 115, 117, 112, 97, 98, 97, 115, 101, 46, 99, 111, 47, 114, 101, 115, 116, 47, 118, 49, 47, 112, 111, 115, 116, 115])); const image = document.createElement('img'); image.src = endpoint;` },
    ],
  }));
  expectRejected('Object.defineProperties raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-object-define-properties-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const image = document.createElement('img'); Object.defineProperties(image, { src: { value: endpoint } });` },
    ],
  }));
  expectRejected('Reflect.set raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-reflect-set-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const image = document.createElement('img'); Reflect.set(image, 'src', endpoint);` },
    ],
  }));
  expectRejected('setAttribute srcset raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-set-attribute-srcset-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const image = document.createElement('img'); image.setAttribute('srcset', endpoint);` },
    ],
  }));
  expectRejected('JSX anchor ping raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-jsx-anchor-ping-rest-resource.tsx', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); export const RawEndpointAnchor = () => <a href="/continue" ping={endpoint}>Continue</a>;` },
    ],
  }));
  expectRejected('DOM area ping raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-dom-area-ping-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const area = document.createElement('area'); area.ping = endpoint;` },
    ],
  }));
  expectRejected('setAttribute ping raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-set-attribute-ping-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const anchor = document.createElement('a'); anchor.setAttribute('ping', endpoint);` },
    ],
  }));
  expectRejected('static HTML anchor ping raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(
        indexHtmlPath,
        `<a href="/continue" ping="https://safe.example.invalid/ping https://project.example.invalid/rest/v1/video_renders">Continue</a>`,
      ),
    ],
  }));
  expectRejected('JSX SVG xlinkHref raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-jsx-svg-xlink-href-rest-resource.tsx', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); export const RawEndpointSvg = () => <svg><image xlinkHref={endpoint} /></svg>;` },
    ],
  }));
  expectRejected('DOM SVG xlinkHref setAttributeNS raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-dom-svg-xlink-href-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const image = document.createElementNS('http://www.w3.org/2000/svg', 'image'); image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', endpoint);` },
    ],
  }));
  expectRejected('DOM SVG href baseVal raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-dom-svg-href-base-val-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const image = document.createElementNS('http://www.w3.org/2000/svg', 'image') as SVGImageElement; image.href.baseVal = endpoint;` },
    ],
  }));
  expectRejected('static HTML SVG xlink:href raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(indexHtmlPath, `<svg><image xlink:href="https://project.example.invalid/rest/v1/video_renders"></image></svg>`),
    ],
  }));
  expectRejected('browser-reachable SVG href raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticSvgResourceAttributesFromSvg(join(root, 'public', 'rls-contract.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://project.example.invalid/rest/v1/video_renders" width="1" height="1" /></svg>`),
    ],
  }));
  expectRejected('browser-reachable SVG xlink:href raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticSvgResourceAttributesFromSvg(join(root, 'public', 'rls-contract.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="https://project.example.invalid/rest/v1/video_renders" width="1" height="1" /></svg>`),
    ],
  }));
  expectRejected('browser-reachable SVG CSS URL raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticSvgResourceAttributesFromSvg(join(root, 'public', 'rls-contract.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><style>rect { background-image: url('https://project.example.invalid/rest/v1/video_renders'); }</style><rect width="1" height="1" /></svg>`),
    ],
  }));
  expectRejected('base-resolved JSX iframe raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      {
        path: 'src/rls-contract-base-resolved-jsx-iframe-rest-resource.tsx',
        source: `export const RawEndpointFrame = () => <iframe src="v1/video_renders" />;`,
        documentBaseHref: 'https://project.example.invalid/rest/',
      },
    ],
  }));
  expectRejected('base-resolved DOM iframe raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      {
        path: 'src/rls-contract-base-resolved-dom-iframe-rest-resource.ts',
        source: `const frame = document.createElement('iframe'); frame.src = 'v1/video_renders';`,
        documentBaseHref: 'https://project.example.invalid/rest/',
      },
    ],
  }));
  expectRejected('runtime base href raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      {
        path: 'src/rls-contract-runtime-base-rest-resource.tsx',
        source: `const base = document.getElementById('route-base') as HTMLBaseElement; const baseUrl = String(import.meta.env.VITE_SUPABASE_URL) + '/rest/'; base.href = baseUrl; export const RawEndpointFrame = () => <iframe src="v1/video_renders" />;`,
      },
    ],
  }));
  expectRejected('runtime base setAttribute raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      {
        path: 'src/rls-contract-runtime-base-set-attribute-rest-resource.ts',
        source: `const base = document.createElement('base'); const baseUrl = String(import.meta.env.VITE_SUPABASE_URL) + '/rest/'; base.setAttribute('href', baseUrl);`,
      },
    ],
  }));
  expectRejected('runtime base setAttributeNS raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      {
        path: 'src/rls-contract-runtime-base-set-attribute-ns-rest-resource.ts',
        source: `const base = document.createElement('base'); const baseUrl = String(import.meta.env.VITE_SUPABASE_URL) + '/rest/'; base.setAttributeNS(null, 'href', baseUrl);`,
      },
    ],
  }));
  expectRejected('runtime base Attr value raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      {
        path: 'src/rls-contract-runtime-base-attr-value-rest-resource.tsx',
        source: `const base = document.getElementById('route-base') as HTMLBaseElement; const href = base.attributes.getNamedItem('href')!; href.value = String(import.meta.env.VITE_SUPABASE_URL) + '/rest/'; export const RawEndpointFrame = () => <iframe src="v1/video_renders" />;`,
      },
    ],
  }));
  expectRejected('runtime base outerHTML raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      {
        path: 'src/rls-contract-runtime-base-outer-html-rest-resource.tsx',
        source: `const holder = document.getElementById('route-base')!; holder.outerHTML = \`<base href="\${String(import.meta.env.VITE_SUPABASE_URL)}/rest/">\`; export const RawEndpointFrame = () => <iframe src="v1/video_renders" />;`,
      },
    ],
  }));
  expectRejected('function-returned JSX raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-function-return-jsx-rest-resource.tsx', source: `function rawEndpoint() { return String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); } const endpointAlias = rawEndpoint; export const RawEndpointFrame = () => <iframe src={endpointAlias()} />;` },
    ],
  }));
  expectRejected('class-method JSX raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-class-method-jsx-rest-resource.tsx', source: `class UrlFactory { static raw() { return String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); } } export const RawEndpointFrame = () => <iframe src={UrlFactory.raw()} />;` },
    ],
  }));
  expectRejected('class-getter JSX raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-class-getter-jsx-rest-resource.tsx', source: `class UrlFactory { static get raw() { return String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); } } export const RawEndpointFrame = () => <iframe src={UrlFactory.raw} />;` },
    ],
  }));
  expectRejected('imported getter JSX raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-imported-raw-url.ts', source: `export class UrlFactory { static get raw() { return String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); } }` },
      { path: 'src/rls-contract-imported-getter-jsx-rest-resource.tsx', source: `import { UrlFactory } from './rls-contract-imported-raw-url'; export const RawEndpointFrame = () => <iframe src={UrlFactory.raw} />;` },
    ],
  }));
  expectRejected('JSX form raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-jsx-form-rest-resource.tsx', source: `const rest = '/re' + 'st'; const v1 = '/v' + '1/'; const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + rest + v1 + ['video', 'renders'].join('_'); export const RawEndpointForm = () => <form action={endpoint} />;` },
    ],
  }));
  expectRejected('DOM iframe raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-dom-iframe-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const frame = document.createElement('iframe'); frame.src = endpoint;` },
    ],
  }));
  expectRejected('setAttribute raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-set-attribute-rest-resource.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const frame = document.createElement('iframe'); frame.setAttribute('src', endpoint);` },
    ],
  }));
  expectRejected('static HTML iframe raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(indexHtmlPath, `<iframe src="https://project.example.invalid/rest/v1/video_renders"></iframe>`),
    ],
  }));
  expectRejected('static HTML background raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(indexHtmlPath, `<body background="https://project.example.invalid/rest/v1/video_renders"></body>`),
    ],
  }));
  expectRejected('static HTML data configuration raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlConfigurationAttributesFromHtml(indexHtmlPath, `<div id="endpoint-config" data-endpoint="https://project.example.invalid/rest/v1/video_renders"></div>`),
    ],
  }));
  expectRejected('static HTML data configuration Supabase base', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlConfigurationAttributesFromHtml(indexHtmlPath, `<div id="endpoint-config" data-base="https://project.supabase.co"></div>`),
    ],
  }));
  expectRejected('static HTML text configuration raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlTextConfigurationValuesFromHtml(indexHtmlPath, `<span hidden id="endpoint-config">https://project.supabase.co/rest/v1/video_renders</span>`),
    ],
  }));
  expectRejected('static HTML comment configuration raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlCommentConfigurationValuesFromHtml(indexHtmlPath, `<!--https://project.supabase.co/rest/v1/video_renders--><span id="marker" hidden></span>`),
    ],
  }));
  expectRejected('static HTML srcdoc nested raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(indexHtmlPath, `<iframe srcdoc="&lt;img src=&quot;https://project.example.invalid/rest/v1/video_renders&quot;&gt;"></iframe>`),
    ],
  }));
  expectRejected('static HTML inline-style raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(indexHtmlPath, `<div style="background-image: url('https://project.example.invalid/rest/v1/video_renders')"></div>`),
    ],
  }));
  expectRejected('static HTML style-block raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(indexHtmlPath, `<style>.render { background-image: url(\"https://project.example.invalid/rest/v1/video_renders\"); }</style>`),
    ],
  }));
  expectRejected('static HTML image-set raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(indexHtmlPath, `<style>.render { background-image: image-set(\"https://project.example.invalid/rest/v1/video_renders\" 1x); }</style>`),
    ],
  }));
  expectRejected('browser CSS file raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticCssResourceAttributesFromCss(join(root, 'src', 'rls-contract.css'), `.render { background-image: url('https://project.example.invalid/rest/v1/video_renders'); }`),
    ],
  }));
  expectRejected('static HTML srcset raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(
        indexHtmlPath,
        `<img srcset="/safe-preview.webp 1x, https://project.example.invalid/rest/v1/video_renders 2x">`,
      ),
    ],
  }));
  expectRejected('static HTML imagesrcset raw PostgREST preload resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(
        indexHtmlPath,
        `<link rel="preload" as="image" href="/safe-placeholder.png" imagesrcset="https://project.example.invalid/rest/v1/video_renders 1x">`,
      ),
    ],
  }));
  expectRejected('base-resolved static HTML raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(
        indexHtmlPath,
        `<base href="https://project.example.invalid/rest/"><iframe src="v1/video_renders"></iframe>`,
      ),
    ],
  }));
  expectRejected('static HTML meta-refresh raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlMetaRefreshesFromHtml(
        indexHtmlPath,
        `<meta http-equiv="refresh" content="0;url=https://project.example.invalid/rest/v1/video_renders">`,
      ),
    ],
  }));
  expectRejected('base-resolved static HTML meta-refresh raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlMetaRefreshesFromHtml(
        indexHtmlPath,
        `<base href="https://project.example.invalid/rest/"><meta http-equiv="refresh" content="0;url=v1/video_renders">`,
      ),
    ],
  }));
  expectRejected('entity-encoded static HTML meta-refresh raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlMetaRefreshesFromHtml(
        indexHtmlPath,
        `<meta content="0;URL=https&#58;&sol;&sol;project.example.invalid&sol;rest&#x2f;v1&sol;video_renders" http-equiv="refresh">`,
      ),
    ],
  }));
  expectRejected('srcdoc static HTML meta-refresh raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlMetaRefreshesFromHtml(
        indexHtmlPath,
        `<iframe srcdoc="&lt;meta http-equiv=&quot;refresh&quot; content=&quot;0;url=https://project.example.invalid/rest/v1/video_renders&quot;&gt;"></iframe>`,
      ),
    ],
  }));
  expectRejected('entity-encoded static HTML raw PostgREST resource', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...staticHtmlResourceAttributesFromHtml(indexHtmlPath, `<form action="https://project.example.invalid/rest&#x2f;v1/video_renders"></form>`),
    ],
  }));
  expectRejected('bare open raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-open-rest-navigation.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); open(endpoint, '_self');` },
    ],
  }));
  expectRejected('extracted open raw PostgREST navigation', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-open-alias-rest-navigation.ts', source: `const endpoint = String(import.meta.env.VITE_SUPABASE_URL) + '/rest' + '/v1/' + ['video', 'renders'].join('_'); const navigate = window.open; navigate(endpoint, '_self');` },
    ],
  }));
  expectRejected('computed global browser transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-computed-global-transport.ts', source: `const method = ['fe', 'tch'].join(''); globalThis[method]('/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('aliased global browser transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-aliased-global-transport.ts', source: `const request = globalThis['fetch']; request('/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('direct browser realtime transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-websocket.ts', source: `new WebSocket('wss://example.invalid/realtime');` },
    ],
  }));
  expectRejected('aliased browser native transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-aliased-native-transport.ts', source: `const Transport = XMLHttpRequest; const request = new Transport(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('reflective browser native transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-reflective-native-transport.ts', source: `const Xhr = Reflect.get(globalThis, 'XMLHttpRequest'); const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('logical browser global native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-logical-global-native-transport.ts', source: `const host = window || globalThis; const Xhr = host.XMLHttpRequest; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('sequence browser global native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-sequence-global-native-transport.ts', source: `const host = (0, globalThis); const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('satisfies browser global native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-satisfies-global-native-transport.ts', source: `const host = globalThis satisfies unknown; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('nested browser global native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-nested-global-native-transport.ts', source: `const Xhr = globalThis.window.XMLHttpRequest; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('named global WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-named-global-window-native-transport.ts', source: `const host = (globalThis as any).xotFrame; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('browser global valueOf native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-global-value-of-native-transport.ts', source: `const host = globalThis.valueOf(); const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('document defaultView native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-document-default-view-transport.ts', source: `const Xhr = document.defaultView!.XMLHttpRequest; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('computed document defaultView native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-computed-document-default-view-transport.ts', source: `const view = ['default', 'View'].join(''); const host = (document as any)[view]; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('window top native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-window-top-native-transport.ts', source: `const Xhr = window.top!.XMLHttpRequest; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('bare parent WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-bare-parent-native-transport.ts', source: `const host = parent; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('indexed window frame native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-window-frame-native-transport.ts', source: `const Xhr = window.frames[0].XMLHttpRequest; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('window popup native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-window-popup-native-transport.ts', source: `const host = window.open('about:blank')!; const Xhr = host.XMLHttpRequest; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('bare popup native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-bare-popup-native-transport.ts', source: `document.addEventListener('click', () => { const host = open('about:blank')!; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); });` },
    ],
  }));
  expectRejected('window popup fetch transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-window-popup-fetch.ts', source: `window.open('about:blank')!.fetch('/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('iframe WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-iframe-native-transport.ts', source: `const frame = document.createElement('iframe'); document.body!.append(frame); const host = frame.contentWindow!; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('computed iframe WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-computed-iframe-native-transport.ts', source: `const frame = document.createElement('iframe'); document.body!.append(frame); const member = ['content', 'Window'].join(''); const host = (frame as any)[member]; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('destructured computed iframe WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-destructured-computed-iframe-native-transport.ts', source: `function issueRaw(frame: HTMLIFrameElement) { const member = ['content', 'Window'].join(''); const [host] = [(frame as any)[member]]; const key = ['XML', 'HttpRequest'].join(''); const [Xhr] = [(host as any)[key]]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); }` },
    ],
  }));
  expectRejected('container-laundered computed iframe WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-container-computed-iframe-native-transport.ts', source: `const frame = document.createElement('iframe'); document.body!.append(frame); const member = ['content', 'Window'].join(''); const holder = { host: (frame as any)[member] }; const Xhr = (holder.host as any).XMLHttpRequest; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('generic computed member helper iframe WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-helper-computed-iframe-native-transport.ts', source: `const frame = document.createElement('iframe'); document.body!.append(frame); function readMember(value: any, key: string) { return value[key]; } const host = readMember(frame, ['content', 'Window'].join('')); const Xhr = readMember(host, ['XML', 'HttpRequest'].join('')); const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('container-laundered browser host native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-container-native-transport.ts', source: `const host = [window][0]; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('ownerDocument WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-owner-document-native-transport.ts', source: `const host = document.body!.ownerDocument!.defaultView!; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('getRootNode WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-root-node-native-transport.ts', source: `const host = (document.body!.getRootNode() as Document).defaultView!; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('UIEvent view WindowProxy native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-ui-event-view-native-transport.ts', source: `document.addEventListener('click', (event: MouseEvent) => { const host = event.view!; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); });` },
    ],
  }));
  expectRejected('event-listener this Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-event-listener-this-native-transport.ts', source: `window.addEventListener('load', function () { const host = this; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); });` },
    ],
  }));
  expectRejected('computed navigator beacon transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-computed-navigator-beacon.ts', source: `const member = ['send', 'Beacon'].join(''); const beacon = (navigator as any)[member].bind(navigator); beacon('/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('global navigator beacon transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-global-navigator-beacon.ts', source: `const member = ['send', 'Beacon'].join(''); const host = globalThis.navigator; const beacon = (host as any)[member].bind(host); beacon('/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('bare clientInformation beacon transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-bare-client-information-beacon.ts', source: `const key = ['send', 'Beacon'].join(''); const beacon = (clientInformation as any)[key].bind(clientInformation); beacon('/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('global clientInformation beacon transport', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-global-client-information-beacon.ts', source: `const nav = globalThis.clientInformation; const key = ['send', 'Beacon'].join(''); const beacon = (nav as any)[key].bind(nav); beacon('/rest' + '/v1/' + ['video', 'renders'].join('_'));` },
    ],
  }));
  expectRejected('event currentTarget Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-event-current-target-native-transport.ts', source: `addEventListener('load', (event) => { const host = event.currentTarget as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); });` },
    ],
  }));
  expectRejected('event target Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-event-target-native-transport.ts', source: `globalThis.addEventListener('x', (event) => { const host = event.target as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); }); globalThis.dispatchEvent(new Event('x'));` },
    ],
  }));
  expectRejected('event composedPath Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-event-composed-path-native-transport.ts', source: `globalThis.addEventListener('x', (event) => { const host = event.composedPath().at(-1) as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); }); globalThis.dispatchEvent(new Event('x'));` },
    ],
  }));
  expectRejected('MessageEvent source Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-message-event-source-native-transport.ts', source: `globalThis.addEventListener('message', (event) => { const host = event.source as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); }); globalThis.postMessage('x', '*');` },
    ],
  }));
  expectRejected('named MessageEvent source Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-named-message-event-source-native-transport.ts', source: `const onMessage = (payload: MessageEvent) => { const host = payload.source as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); }; globalThis.addEventListener('message', onMessage); globalThis.postMessage('x', '*');` },
    ],
  }));
  expectRejected('global MessageEvent source Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-global-message-event-source-native-transport.ts', source: `globalThis.addEventListener('message', () => { const host = globalThis.event!.source as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); }); globalThis.postMessage('x', '*');` },
    ],
  }));
  expectRejected('onmessage MessageEvent source Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-onmessage-source-native-transport.ts', source: `globalThis.onmessage = (payload: MessageEvent) => { const host = payload.source as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); }; globalThis.postMessage('x', '*');` },
    ],
  }));
  expectRejected('named onmessage MessageEvent source Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-named-onmessage-source-native-transport.ts', source: `function receive(payload: MessageEvent) { const host = payload.source as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); } globalThis.onmessage = receive; globalThis.postMessage('x', '*');` },
    ],
  }));
  expectRejected('extracted global message listener source Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-extracted-message-listener-source-native-transport.ts', source: `globalThis.addEventListener.call(globalThis, 'message', (payload: MessageEvent) => { const host = payload.source as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); }); globalThis.postMessage('x', '*');` },
    ],
  }));
  expectRejected('EventListenerObject MessageEvent source Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-event-listener-object-source-native-transport.ts', source: `globalThis.addEventListener('message', { handleEvent(payload: Event) { const host = (payload as MessageEvent).source as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); } }); globalThis.postMessage('x', '*');` },
    ],
  }));
  expectRejected('named EventListenerObject MessageEvent source Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-named-event-listener-object-source-native-transport.ts', source: `const listener = { handleEvent(payload: MessageEvent) { const host = payload.source as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); } }; globalThis.addEventListener('message', listener); globalThis.postMessage('x', '*');` },
    ],
  }));
  expectRejected('forwarded MessageEvent source Window native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-forwarded-message-event-source-native-transport.ts', source: `function register(callback: EventListener) { globalThis.addEventListener('message', callback); } function receive(payload: Event) { const host = (payload as MessageEvent).source as Window; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send(); } register(receive); globalThis.postMessage('x', '*');` },
    ],
  }));
  expectRejected('dynamic Function transport construction', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-dynamic-function-transport.ts', source: `const execute = new Function(\"return globalThis['fe' + 'tch']('/rest' + '/v1/' + ['video', 'renders'].join('_'))\"); execute();` },
    ],
  }));
  expectRejected('dynamic eval transport construction', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-dynamic-eval-transport.ts', source: `eval(\"globalThis['fe' + 'tch']('/rest' + '/v1/' + ['video', 'renders'].join('_'))\");` },
    ],
  }));
  expectRejected('dynamic constructor transport construction', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-dynamic-constructor-transport.ts', source: `const execute = ({}).constructor.constructor(\"return globalThis['fe' + 'tch']('/rest' + '/v1/' + ['video', 'renders'].join('_'))\"); execute();` },
    ],
  }));
  expectRejected('browser global prototype native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-global-prototype-native-transport.ts', source: `const host = globalThis.__proto__; const key = ['XML', 'HttpRequest'].join(''); const Xhr = (host as any)[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('opaque dynamic import transport construction', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-opaque-dynamic-import-transport.ts', source: `import(\"data:text/javascript,globalThis['fe' + 'tch']('/rest' + '/v1/' + ['video', 'renders'].join('_'))\");` },
    ],
  }));
  expectRejected('opaque external script transport construction', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'index.html:external-script-0.js', source: `import \"data:text/javascript,globalThis['fe' + 'tch']('/rest' + '/v1/' + ['video', 'renders'].join('_'))\";` },
    ],
  }));
  expectRejected('opaque worker transport construction', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-opaque-worker-transport.ts', source: `new Worker(URL.createObjectURL(new Blob([\"globalThis['fe' + 'tch']('/rest' + '/v1/' + ['video', 'renders'].join('_'))\"])));` },
    ],
  }));
  expectRejected('thrown browser host native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-thrown-host-native-transport.ts', source: `let host: any; try { throw window; } catch (caught) { host = caught; } const key = ['XML', 'HttpRequest'].join(''); const Xhr = host[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('yielded browser host native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-yielded-host-native-transport.ts', source: `function* leak() { yield window; } const host: any = leak().next().value; const key = ['XML', 'HttpRequest'].join(''); const Xhr = host[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('parameter-default browser host native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-parameter-host-native-transport.ts', source: `function leak(host: any = window) { return host; } const host = leak(); const key = ['XML', 'HttpRequest'].join(''); const Xhr = host[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('binding-default browser host native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-binding-host-native-transport.ts', source: `const [host = window]: any[] = []; const key = ['XML', 'HttpRequest'].join(''); const Xhr = host[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  expectRejected('class-property browser host native transport alias', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-class-host-native-transport.ts', source: `class HostBox { static host: any = window; } const host = HostBox.host; const key = ['XML', 'HttpRequest'].join(''); const Xhr = host[key]; const request = new Xhr(); request.open('GET', '/rest' + '/v1/' + ['video', 'renders'].join('_')); request.send();` },
    ],
  }));
  const assertReachableTestBypass = (label, fixtureFiles, targetPath) => {
    const selectedFixture = selectBrowserScriptFiles(fixtureFiles);
    assert.ok(
      selectedFixture.some((file) => file.path === targetPath),
      `${label} must include the reachable test module in the browser source scan`,
    );
    assert.ok(
      sourceFileIssues(selectedFixture).some((issue) => (
        issue.startsWith(`${targetPath}:`)
        && issue.includes('protected raw table')
      )),
      `${label} must deny direct protected-table access from the reachable test module`,
    );
  };
  assertReachableTestBypass('static test import', [
    { path: 'src/rls-contract-test-importer.ts', source: `import './test/rls-contract-test-directory-bypass';` },
    { path: 'src/test/rls-contract-test-directory-bypass.ts', source: `supabase.from('video_renders');` },
  ], 'src/test/rls-contract-test-directory-bypass.ts');
  assertReachableTestBypass('Vite glob test import', [
    { path: 'src/rls-contract-glob-importer.ts', source: `const modules = import.meta.glob('./test/rls-contract-glob-bypass.ts', { eager: true });` },
    { path: 'src/test/rls-contract-glob-bypass.ts', source: `supabase.from('video_renders');` },
  ], 'src/test/rls-contract-glob-bypass.ts');
  assertReachableTestBypass('external script test import', [
    ...inlineBrowserScriptsFromHtml(indexHtmlPath, `<script type="module" src="/src/test/rls-contract-external-script-bypass.js"></script>`),
    { path: 'src/test/rls-contract-external-script-bypass.js', source: `supabase.from('video_renders');` },
  ], 'src/test/rls-contract-external-script-bypass.js');
  assertReachableTestBypass('MTS test import', [
    { path: 'src/rls-contract-mts-importer.ts', source: `import './test/rls-contract-mts-bypass';` },
    { path: 'src/test/rls-contract-mts-bypass.mts', source: `supabase.from('video_renders');` },
  ], 'src/test/rls-contract-mts-bypass.mts');
  assertReachableTestBypass('Vite worker URL test import', [
    { path: 'src/rls-contract-worker-importer.ts', source: `new Worker(new URL('./test/rls-contract-worker-bypass.ts', import.meta.url), { type: 'module' });` },
    { path: 'src/test/rls-contract-worker-bypass.ts', source: `supabase.from('video_renders');` },
  ], 'src/test/rls-contract-worker-bypass.ts');
  assertReachableTestBypass('static worker URL test import', [
    { path: 'src/rls-contract-static-worker-importer.ts', source: `new SharedWorker('./test/rls-contract-static-worker-bypass.ts', { type: 'module' });` },
    { path: 'src/test/rls-contract-static-worker-bypass.ts', source: `supabase.from('video_renders');` },
  ], 'src/test/rls-contract-static-worker-bypass.ts');
  assertReachableTestBypass('Vite worker query test import', [
    { path: 'src/rls-contract-worker-query-importer.ts', source: `import WorkerCtor from './test/rls-contract-worker-query-bypass.ts?worker'; new WorkerCtor();` },
    { path: 'src/test/rls-contract-worker-query-bypass.ts', source: `supabase.from('video_renders');` },
  ], 'src/test/rls-contract-worker-query-bypass.ts');
  expectRejected('data-type inline browser raw query', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...inlineBrowserScriptsFromHtml(indexHtmlPath, `<script data-type="application/json">supabase.from('video_renders');</script>`),
    ],
  }));
  expectRejected('entity-encoded inline browser raw query', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...inlineBrowserScriptsFromHtml(indexHtmlPath, `<script type="text/java&#x73;cript">supabase.from('video_renders');</script>`),
    ],
  }));
  expectRejected('srcdoc inline browser raw endpoint', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      ...inlineBrowserScriptsFromHtml(indexHtmlPath, `<iframe srcdoc="&lt;script&gt;fetch('https://project.example.invalid/rest/v1/video_renders')&lt;/script&gt;"></iframe>`),
    ],
  }));
  expectRejected('public browser raw query', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'public/rls-contract-public-query.js', source: `supabase.from('video_renders');` },
    ],
  }));
  expectRejected('qualified browser target Realtime subscription', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-qualified-realtime.ts', source: `supabase.channel('bypass').on('postgres_changes', { table: 'public.manual_video_intakes' });` },
    ],
  }));
  expectRejected('computed browser target Realtime subscription', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-computed-realtime.ts', source: `const rawTable = 'video_renderer_heartbeats'; supabase.channel('bypass').on('postgres_changes', { table: rawTable });` },
    ],
  }));
  expectRejected('spread browser target Realtime subscription', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-spread-realtime.ts', source: `const rawTable = ['video', 'renders'].join('_'); const config = { table: rawTable }; supabase.channel('bypass').on('postgres_changes', { ...config });` },
    ],
  }));
  expectRejected('computed browser Realtime event', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-computed-event.ts', source: `const event = 'postgres_changes'; supabase.channel('bypass').on(event, { table: 'posts' });` },
    ],
  }));
  expectRejected('computed browser Realtime method', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-computed-method.ts', source: `const method = 'on'; supabase.channel('bypass')[method]('postgres_changes', { table: 'posts' });` },
    ],
  }));
  expectRejected('aliased browser Realtime subscription', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-aliased-realtime.ts', source: `const subscription = supabase.channel('bypass'); const event = ['postgres', 'changes'].join('_'); const rawTable = ['video', 'renders'].join('_'); subscription.on(event, { ...{ table: rawTable } });` },
    ],
  }));
  expectRejected('Supabase client barrel re-export', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-supabase-barrel.ts', source: `export * from '@/integrations/supabase/client';` },
      { path: 'src/rls-contract-supabase-barrel-consumer.ts', source: `import { supabase as client } from './rls-contract-supabase-barrel'; const method = ['fr', 'om'].join(''); const rawTable = ['video', 'renders'].join('_'); client[method](rawTable);` },
    ],
  }));
  expectRejected('dynamic Supabase client import', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-dynamic-client-import.ts', source: `import('@supabase/' + 'supabase-js');` },
    ],
  }));
  expectRejected('dynamic Supabase client require', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-client-require.ts', source: `const { createClient } = require('@supabase/supabase-js'); createClient('https://example.invalid', 'key');` },
    ],
  }));
  expectRejected('extracted Realtime subscription method', (source) => ({
    ...source,
    frontendFiles: [
      ...source.frontendFiles,
      { path: 'src/rls-contract-extracted-realtime-method.ts', source: `const subscribe = supabase.channel('bypass').on; subscribe('postgres_changes', { table: ['video', 'renders'].join('_') });` },
    ],
  }));
  expectRejected('raw table added to dynamic Realtime allowlist', (source) => ({
    ...source,
    monitoringRealtime: source.monitoringRealtime.replace(
      "  'ai_call_ledger',",
      "  'ai_call_ledger',\n  'video_renders',",
    ),
  }));
  expectRejected('authorization after service client construction', (source) => ({
    ...source,
    adminActions: source.adminActions.replace(
      'const authResult = await requireAdmin(req, corsHeaders);',
      'const authResult = await requireAdminLater(req, corsHeaders);',
    ),
  }));
  expectRejected('browser-executable renderer RPC', (source) => ({
    ...source,
    videoPipeline: source.videoPipeline.replace(
      'GRANT EXECUTE ON FUNCTION public.claim_video_renders(integer,text) TO service_role;',
      'GRANT EXECUTE ON FUNCTION public.claim_video_renders(integer,text) TO authenticated;',
    ),
  }));
  expectRejected('public renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: source.videoPipeline.replace(
      'GRANT EXECUTE ON FUNCTION public.claim_video_renders(integer,text) TO service_role;',
      'GRANT EXECUTE ON FUNCTION public.claim_video_renders(integer,text) TO service_role, PUBLIC;',
    ),
  }));
  expectRejected('all-privileges renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: source.videoPipeline.replace(
      'GRANT EXECUTE ON FUNCTION public.claim_video_renders(integer,text) TO service_role;',
      'GRANT ALL PRIVILEGES ON FUNCTION public.claim_video_renders(integer,text) TO authenticated;',
    ),
  }));
  expectRejected('quoted all-privileges renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nGRANT ALL PRIVILEGES ON FUNCTION public."claim_video_renders"(integer,text) TO authenticated;`,
  }));
  expectRejected('type-alias all-privileges renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nGRANT ALL PRIVILEGES ON FUNCTION public.claim_video_renders(int,text) TO authenticated;`,
  }));
  expectRejected('Unicode-escaped renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nGRANT ALL PRIVILEGES ON FUNCTION public.U&"claim\\005fvideo\\005frenders"(integer,text) TO authenticated;`,
  }));
  expectRejected('group renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nGRANT ALL PRIVILEGES ON FUNCTION public.claim_video_renders(integer,text) TO GROUP authenticated;`,
  }));
  expectRejected('dynamic renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nDO $$ BEGIN EXECUTE 'GRANT ALL PRIVILEGES ON FUNCTION public.claim_video_renders(integer,text) TO authenticated'; END $$;`,
  }));
  expectRejected('browser schema-wide renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nGRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;`,
  }));
  expectRejected('all-privileges schema-wide renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nGRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO authenticated;`,
  }));
  expectRejected('commented quoted schema-wide renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nGRANT /* browser */ ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "public" TO authenticated WITH GRANT OPTION;`,
  }));
  expectRejected('multi-schema renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nGRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA pg_catalog, public TO authenticated;`,
  }));
  expectRejected('unicode-schema renderer RPC grant', (source) => ({
    ...source,
    videoPipeline: `${source.videoPipeline}\nGRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA U&"pub\\006cic" TO authenticated;`,
  }));
  expectRejected('newer protected RPC migration', (source) => ({
    ...source,
    newerRelevantMigrations: ['20260724000000_browser_grants_video_release_rpc.sql'],
  }));
  assert.equal(
    migrationTouchesProtectedAccessSurface('GRANT EXECUTE ON FUNCTION public._video_render_should_release(text) TO authenticated;'),
    true,
    'later protected RPC grants must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;'),
    true,
    'later schema-wide browser RPC grants must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('GRANT /* browser */ ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "public" TO authenticated;'),
    true,
    'later quoted/commented schema-wide all-privileges RPC grants must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA pg_catalog, public TO authenticated;'),
    true,
    'later multi-schema raw-table grants must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA U&"pub\\006cic" TO authenticated;'),
    true,
    'later Unicode-escaped schema-wide RPC grants must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('GRANT ALL PRIVILEGES ON FUNCTION public.U&"claim\\005fvideo\\005frenders"(integer,text) TO authenticated;'),
    true,
    'later Unicode-escaped direct RPC grants must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('ALTER ROLE authenticated BYPASSRLS;'),
    true,
    'later role-attribute changes must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface("DO $$ BEGIN EXECUTE 'GRANT ' || 'ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO authenticated'; END $$;"),
    true,
    'later dynamic SQL migrations must enter the review gate even when protected names are fragmented',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('GRANT service_role TO authenticated;'),
    true,
    'later role-membership grants must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('GRANT U&"service\\005frole" TO "authenticated";'),
    true,
    'later quoted or Unicode-escaped role-membership grants must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('GRANT EXECUTE ON FUNCTION public.unreviewed_status() TO authenticated;'),
    true,
    'later browser-callable functions must enter the review gate even without protected names',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface(
      'CREATE FUNCTION public.unreviewed_status() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT \'ok\' $$;',
    ),
    true,
    'later SECURITY DEFINER functions must enter the review gate even without an explicit grant',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('ALTER FUNCTION public.unreviewed_status() OWNER TO service_role;'),
    true,
    'later function ownership changes must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('ALTER TABLE public.video_renders ENABLE ROW LEVEL SECURITY;'),
    true,
    'later protected raw-table migrations must enter the review gate',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface('CREATE TABLE public.unrelated_audit_events (id uuid primary key);'),
    false,
    'unrelated forward migrations must not block the raw-table contract',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface(
      read(join(migrationsDirectory, '20260724183000_add_current_user_is_admin_rpc.sql')),
      '20260724183000_add_current_user_is_admin_rpc.sql',
    ),
    false,
    'the byte-locked caller-bound admin-role helper must not be treated as a raw-video access migration',
  );
  assert.equal(
    migrationTouchesProtectedAccessSurface(
      read(join(migrationsDirectory, '20260724183000_add_current_user_is_admin_rpc.sql')),
      'unreviewed_copy.sql',
    ),
    true,
    'the caller-bound admin-role helper must be exempt only at its reviewed filename and exact bytes',
  );
  expectRejected('renderer browser credential', (source) => ({
    ...source,
    rendererConfig: source.rendererConfig.replace('"SUPABASE_SERVICE_ROLE_KEY"', '"SUPABASE_ANON_KEY"'),
  }));
  selfTest = 'pass';
}

console.log(
  `VIDEO_RENDER_RLS_SOURCE_CONTRACT_PASS tables=${tables.length} browserRawAccess=denied serviceAccess=preserved selfTest=${selfTest}`,
);
