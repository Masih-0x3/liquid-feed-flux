// 5-Agent Enrichment Pipeline: Archivist + Researcher (parallel) -> Analyst -> Humanizer -> Composer
import { callOpenAI, type OpenAICallParams, type NormalizedOpenAIResponse } from "./openai.ts";

export interface EnrichmentConfig {
  enabled: boolean;
  model: string;
  analyst_prompt: string;
  researcher_prompt: string;
  humanizer_prompt: string;
  archivist_prompt: string;
  composer_prompt: string;
  max_research_tokens: number;
  max_analysis_tokens: number;
  max_humanizer_tokens: number;
  max_archivist_tokens: number;
  max_composer_tokens: number;
  skip_research_below_score: number;
  archivist_lookback_days: number;
  archivist_max_posts: number;
  require_approval: boolean;
  thread_above_score: number;
}

export interface VoiceSamples {
  samples: string[];
  updated_at: string | null;
}

export interface ArchivistOutput {
  has_callback: boolean;
  callback_type: "continuation" | "validation" | "contradiction" | "thematic" | null;
  callback_suggestion: string | null;
  referenced_post_id: string | null;
  narrative_summary: string | null;
}

export interface ResearcherOutput {
  background_summary: string;
  key_facts: string[];
  related_events: string;
  sources: string[];
}

export interface AnalystOutput {
  commentary: string;
  hook: string;
  suggested_question: string | null;
  uses_callback: boolean;
  significance: string;
}

export interface HumanizerOutput {
  humanized_commentary: string;
  humanized_hook: string;
  humanized_question: string | null;
  changes_made: string;
}

export interface ComposerOutput {
  final_text: string;
  format_used: string;
  thread_continuation: string | null;
}

export interface EnrichResult {
  archivist: ArchivistOutput | null;
  researcher: ResearcherOutput | null;
  analyst: AnalystOutput;
  humanizer: HumanizerOutput;
  composer: ComposerOutput;
  totalTokens: number;
  durationMs: number;
}

interface RecentPost {
  tweet_id: string;
  text_translated: string | null;
  editorial_commentary: string | null;
  commentary_hook: string | null;
  importance_score: number | null;
  tweeted_at: string | null;
}

// deno-lint-ignore no-explicit-any
export async function runEnrichPipeline(params: {
  supabase: any;
  apiKey: string;
  config: EnrichmentConfig;
  voiceSamples: VoiceSamples;
  tweetId: string;
  textOriginal: string;
  textTranslated: string;
  importanceScore: number | null;
  previousFormatUsed: string | null;
}): Promise<EnrichResult> {
  const { supabase, apiKey, config, voiceSamples, tweetId, textOriginal, textTranslated, importanceScore, previousFormatUsed } = params;
  const startTime = Date.now();
  let totalTokens = 0;

  const skipResearch = importanceScore !== null && importanceScore < config.skip_research_below_score;

  // Phase 1: Archivist + Researcher in parallel
  const [archivistResult, researcherResult] = await Promise.all([
    runArchivist(supabase, apiKey, config, tweetId, textOriginal, textTranslated),
    skipResearch ? Promise.resolve(null) : runResearcher(apiKey, config, textOriginal),
  ]);

  if (archivistResult?.usage) totalTokens += archivistResult.usage;
  if (researcherResult?.usage) totalTokens += researcherResult.usage;

  // Phase 2: Analyst
  const analystResult = await runAnalyst(apiKey, config, textOriginal, textTranslated, archivistResult?.output ?? null, researcherResult?.output ?? null);
  totalTokens += analystResult.usage;

  // Phase 3: Humanizer
  const humanizerResult = await runHumanizer(apiKey, config, voiceSamples, analystResult.output);
  totalTokens += humanizerResult.usage;

  // Phase 4: Composer
  const composerResult = await runComposer(apiKey, config, textTranslated, humanizerResult.output, archivistResult?.output ?? null, researcherResult?.output ?? null, previousFormatUsed);
  totalTokens += composerResult.usage;

  return {
    archivist: archivistResult?.output ?? null,
    researcher: researcherResult?.output ?? null,
    analyst: analystResult.output,
    humanizer: humanizerResult.output,
    composer: composerResult.output,
    totalTokens,
    durationMs: Date.now() - startTime,
  };
}

// ─── Agent 0: Archivist ───────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
async function runArchivist(supabase: any, apiKey: string, config: EnrichmentConfig, tweetId: string, textOriginal: string, textTranslated: string): Promise<{ output: ArchivistOutput; usage: number } | null> {
  try {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - config.archivist_lookback_days);

    const { data: recentPosts } = await supabase
      .from('posts')
      .select('tweet_id, text_translated, editorial_commentary, commentary_hook, importance_score, tweeted_at')
      .eq('delivery_decision', 'deliver')
      .neq('tweet_id', tweetId)
      .gte('created_at', lookbackDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(config.archivist_max_posts);

    if (!recentPosts || recentPosts.length === 0) {
      return { output: { has_callback: false, callback_type: null, callback_suggestion: null, referenced_post_id: null, narrative_summary: null }, usage: 0 };
    }

    const postsContext = (recentPosts as RecentPost[]).map((p, i) => {
      const text = p.text_translated || '[no translation]';
      const commentary = p.editorial_commentary ? `\nOur commentary: ${p.editorial_commentary}` : '';
      return `[${i + 1}] ID: ${p.tweet_id}\nScore: ${p.importance_score ?? '?'}\nDate: ${p.tweeted_at ?? 'unknown'}\nContent: ${text}${commentary}`;
    }).join('\n\n');

    const tool = {
      name: 'find_narrative_thread',
      description: 'Report whether this story connects to recent coverage',
      parameters: {
        type: 'object',
        properties: {
          has_callback: { type: 'boolean', description: 'Whether a reference to past coverage is warranted' },
          callback_type: { type: 'string', enum: ['continuation', 'validation', 'contradiction', 'thematic', 'null'], description: 'Type of narrative connection, or "null" if none' },
          callback_suggestion: { type: 'string', description: 'Specific phrase in Persian for how to reference the prior post, or empty if none' },
          referenced_post_id: { type: 'string', description: 'The tweet_id of the referenced post, or empty if none' },
          narrative_summary: { type: 'string', description: 'One sentence on the ongoing narrative thread' },
        },
        required: ['has_callback', 'callback_type'],
      },
    };

    const resp = await callOpenAI({
      apiKey,
      model: config.model,
      messages: [
        { role: 'system', content: config.archivist_prompt },
        { role: 'user', content: `NEW STORY:\nOriginal: ${textOriginal}\nPersian: ${textTranslated}\n\nRECENT POSTS (last ${config.archivist_lookback_days} days):\n${postsContext}` },
      ],
      tool,
      maxOutputTokens: config.max_archivist_tokens,
    });

    if (!resp.ok || !resp.toolCall) {
      console.warn('Archivist failed:', resp.status, resp.content?.slice(0, 200));
      return { output: { has_callback: false, callback_type: null, callback_suggestion: null, referenced_post_id: null, narrative_summary: null }, usage: resp.usage?.total_tokens ?? 0 };
    }

    const parsed = JSON.parse(resp.toolCall.arguments);
    const callbackType = parsed.callback_type === 'null' ? null : parsed.callback_type;
    return {
      output: {
        has_callback: parsed.has_callback ?? false,
        callback_type: callbackType,
        callback_suggestion: parsed.callback_suggestion || null,
        referenced_post_id: parsed.referenced_post_id || null,
        narrative_summary: parsed.narrative_summary || null,
      },
      usage: resp.usage?.total_tokens ?? 0,
    };
  } catch (e) {
    console.warn('Archivist error (non-fatal):', (e as Error).message);
    return null;
  }
}

// ─── Agent 1: Researcher ──────────────────────────────────────────────
async function runResearcher(apiKey: string, config: EnrichmentConfig, textOriginal: string): Promise<{ output: ResearcherOutput; usage: number } | null> {
  try {
    const tool = {
      name: 'provide_background',
      description: 'Return structured background research for this news item',
      parameters: {
        type: 'object',
        properties: {
          background_summary: { type: 'string', description: '2-3 sentences of essential context' },
          key_facts: { type: 'array', items: { type: 'string' }, description: 'Array of specific factual bullet points with dates/numbers' },
          related_events: { type: 'string', description: 'What led to this, what happened before' },
          sources: { type: 'array', items: { type: 'string' }, description: 'URLs consulted during research' },
        },
        required: ['background_summary', 'key_facts', 'related_events', 'sources'],
      },
    };

    const resp = await callOpenAI({
      apiKey,
      model: config.model,
      messages: [
        { role: 'system', content: config.researcher_prompt },
        { role: 'user', content: `Research background context for this news item:\n\n${textOriginal}` },
      ],
      tool,
      builtInTools: [{ type: 'web_search' }],
      maxOutputTokens: config.max_research_tokens,
    });

    if (!resp.ok || !resp.toolCall) {
      console.warn('Researcher failed:', resp.status, resp.content?.slice(0, 200));
      return null;
    }

    const parsed = JSON.parse(resp.toolCall.arguments);
    return {
      output: {
        background_summary: parsed.background_summary || '',
        key_facts: Array.isArray(parsed.key_facts) ? parsed.key_facts : [],
        related_events: parsed.related_events || '',
        sources: Array.isArray(parsed.sources) ? parsed.sources : (resp.webSearchResults?.map(r => r.url) ?? []),
      },
      usage: resp.usage?.total_tokens ?? 0,
    };
  } catch (e) {
    console.warn('Researcher error (non-fatal):', (e as Error).message);
    return null;
  }
}

// ─── Agent 2: Analyst ─────────────────────────────────────────────────
async function runAnalyst(apiKey: string, config: EnrichmentConfig, textOriginal: string, textTranslated: string, archivist: ArchivistOutput | null, researcher: ResearcherOutput | null): Promise<{ output: AnalystOutput; usage: number }> {
  const contextParts: string[] = [];
  contextParts.push(`Original English:\n${textOriginal}`);
  contextParts.push(`Persian Translation:\n${textTranslated}`);

  if (researcher) {
    contextParts.push(`Background Research:\n${researcher.background_summary}\nKey facts: ${researcher.key_facts.join('; ')}`);
  }
  if (archivist?.has_callback && archivist.callback_suggestion) {
    contextParts.push(`Narrative Callback Available:\nType: ${archivist.callback_type}\nSuggested phrasing: ${archivist.callback_suggestion}\nContext: ${archivist.narrative_summary}\n\nInstruction: If this callback adds value, weave it naturally into your commentary. Do not force it.`);
  }

  const tool = {
    name: 'compose_analysis',
    description: 'Return editorial commentary for this news item',
    parameters: {
      type: 'object',
      properties: {
        commentary: { type: 'string', description: '2-4 sentences of editorial analysis in Persian' },
        hook: { type: 'string', description: 'A compelling opening line in Persian' },
        suggested_question: { type: 'string', description: 'Optional question in Persian to drive replies, or empty' },
        uses_callback: { type: 'boolean', description: 'Whether the narrative callback was incorporated' },
        significance: { type: 'string', description: 'One sentence on why this matters (internal use)' },
      },
      required: ['commentary', 'hook', 'uses_callback', 'significance'],
    },
  };

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: config.analyst_prompt },
      { role: 'user', content: contextParts.join('\n\n---\n\n') },
    ],
    tool,
    maxOutputTokens: config.max_analysis_tokens,
  });

  if (!resp.ok || !resp.toolCall) {
    throw new Error(`Analyst agent failed: HTTP ${resp.status} - ${resp.content?.slice(0, 300)}`);
  }

  const parsed = JSON.parse(resp.toolCall.arguments);
  return {
    output: {
      commentary: parsed.commentary || '',
      hook: parsed.hook || '',
      suggested_question: parsed.suggested_question || null,
      uses_callback: parsed.uses_callback ?? false,
      significance: parsed.significance || '',
    },
    usage: resp.usage?.total_tokens ?? 0,
  };
}

// ─── Agent 3: Humanizer ───────────────────────────────────────────────
async function runHumanizer(apiKey: string, config: EnrichmentConfig, voiceSamples: VoiceSamples, analyst: AnalystOutput): Promise<{ output: HumanizerOutput; usage: number }> {
  const samplesBlock = voiceSamples.samples.length > 0
    ? `\n\nVoice samples from the author:\n${voiceSamples.samples.map((s, i) => `[${i + 1}] ${s}`).join('\n')}`
    : '\n\n(No voice samples provided yet -- use your best judgment for natural Persian writing style)';

  const systemPrompt = config.humanizer_prompt + samplesBlock;

  const tool = {
    name: 'humanize_text',
    description: 'Return the humanized version of the commentary',
    parameters: {
      type: 'object',
      properties: {
        humanized_commentary: { type: 'string', description: 'The rewritten commentary matching the author voice' },
        humanized_hook: { type: 'string', description: 'The rewritten hook' },
        humanized_question: { type: 'string', description: 'The rewritten question, or empty if none' },
        changes_made: { type: 'string', description: 'Brief note on what was changed for transparency' },
      },
      required: ['humanized_commentary', 'humanized_hook', 'changes_made'],
    },
  };

  const userContent = `Humanize this commentary to sound like the author wrote it personally:\n\nCommentary: ${analyst.commentary}\nHook: ${analyst.hook}${analyst.suggested_question ? `\nQuestion: ${analyst.suggested_question}` : ''}`;

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    tool,
    maxOutputTokens: config.max_humanizer_tokens,
  });

  if (!resp.ok || !resp.toolCall) {
    throw new Error(`Humanizer agent failed: HTTP ${resp.status} - ${resp.content?.slice(0, 300)}`);
  }

  const parsed = JSON.parse(resp.toolCall.arguments);
  return {
    output: {
      humanized_commentary: parsed.humanized_commentary || analyst.commentary,
      humanized_hook: parsed.humanized_hook || analyst.hook,
      humanized_question: parsed.humanized_question || null,
      changes_made: parsed.changes_made || '',
    },
    usage: resp.usage?.total_tokens ?? 0,
  };
}

// ─── Agent 4: Composer ────────────────────────────────────────────────
async function runComposer(apiKey: string, config: EnrichmentConfig, textTranslated: string, humanizer: HumanizerOutput, archivist: ArchivistOutput | null, researcher: ResearcherOutput | null, previousFormatUsed: string | null): Promise<{ output: ComposerOutput; usage: number }> {
  const components: string[] = [];
  components.push(`Translation (core content):\n${textTranslated}`);
  components.push(`Commentary: ${humanizer.humanized_commentary}`);
  components.push(`Hook: ${humanizer.humanized_hook}`);
  if (humanizer.humanized_question) components.push(`Question: ${humanizer.humanized_question}`);
  if (archivist?.has_callback && archivist.callback_suggestion) {
    components.push(`Narrative callback: ${archivist.callback_suggestion}`);
  }
  if (researcher?.background_summary) {
    components.push(`Background (use sparingly): ${researcher.background_summary}`);
  }
  if (previousFormatUsed) {
    components.push(`IMPORTANT: The previous post used format "${previousFormatUsed}". Choose a DIFFERENT format this time.`);
  }

  const tool = {
    name: 'compose_post',
    description: 'Assemble the final X post from the provided components',
    parameters: {
      type: 'object',
      properties: {
        final_text: { type: 'string', description: 'The assembled post ready for X (max 280 chars)' },
        format_used: { type: 'string', enum: ['analysis_lead', 'question_hook', 'context_first', 'callback_lead', 'quote_style', 'plain', 'thread_hook'], description: 'Which format was chosen' },
        thread_continuation: { type: 'string', description: 'Second tweet text if thread format, or empty' },
      },
      required: ['final_text', 'format_used'],
    },
  };

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: config.composer_prompt },
      { role: 'user', content: components.join('\n\n') },
    ],
    tool,
    maxOutputTokens: config.max_composer_tokens,
  });

  if (!resp.ok || !resp.toolCall) {
    throw new Error(`Composer agent failed: HTTP ${resp.status} - ${resp.content?.slice(0, 300)}`);
  }

  const parsed = JSON.parse(resp.toolCall.arguments);
  return {
    output: {
      final_text: parsed.final_text || '',
      format_used: parsed.format_used || 'plain',
      thread_continuation: parsed.thread_continuation || null,
    },
    usage: resp.usage?.total_tokens ?? 0,
  };
}
