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

// Style modifiers randomly injected per run for variety
const STYLE_MODIFIERS = [
  'Use a provocative rhetorical question that challenges the regime narrative.',
  'Be unusually blunt and short -- 2 punchy sentences max. Hit hard, move on.',
  'Point out the hypocrisy or ironic contrast in the situation.',
  'Use dry sarcasm -- mock the regime or its apologists.',
  'Connect this to a broader pattern of regime behavior over the past decades.',
  'Focus on what this means for ordinary Iranians -- the people on the street.',
  'Channel righteous anger -- this is about real people suffering under a theocracy.',
  'Use a vivid metaphor that makes the political situation visceral.',
  'Be analytical and strategic -- focus on what this means for the power balance.',
  'Write as if explaining to a friend in a voice message -- raw and unfiltered.',
  'Start with the most damning or counterintuitive angle the mainstream misses.',
  'Use the language young Iranians on social media would use -- informal, fiery, zero respect for the regime.',
  'Frame this in terms of the larger freedom movement -- where does this fit in the arc toward regime change?',
  'Mock the Western appeasement angle if relevant -- "بازم مذاکره؟"',
  'Name the human cost explicitly -- prisoners, families, lives destroyed.',
];

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randomTopP(): number {
  return 0.85 + Math.random() * 0.15; // 0.85 - 1.0
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

  const skipResearch = importanceScore !== null && config.skip_research_below_score > 0 && importanceScore < config.skip_research_below_score;

  // Pick a style modifier for this run
  const [styleModifier] = pickRandom(STYLE_MODIFIERS, 1);

  // Phase 1: Archivist + Researcher in parallel
  const [archivistResult, researcherResult] = await Promise.all([
    runArchivist(supabase, apiKey, config, tweetId, textOriginal, textTranslated),
    skipResearch ? Promise.resolve(null) : runResearcher(apiKey, config, textOriginal),
  ]);

  if (archivistResult?.usage) totalTokens += archivistResult.usage;
  if (researcherResult?.usage) totalTokens += researcherResult.usage;

  // Phase 2: Analyst
  const analystResult = await runAnalyst(apiKey, config, textOriginal, textTranslated, archivistResult?.output ?? null, researcherResult?.output ?? null, styleModifier);
  totalTokens += analystResult.usage;

  // Phase 3: Humanizer
  const humanizerResult = await runHumanizer(apiKey, config, voiceSamples, analystResult.output, styleModifier);
  totalTokens += humanizerResult.usage;

  // Phase 4: Composer
  const composerResult = await runComposer(apiKey, config, textTranslated, humanizerResult.output, archivistResult?.output ?? null, researcherResult?.output ?? null, previousFormatUsed, styleModifier);
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

    const systemPrompt = `${config.archivist_prompt}

IMPORTANT RULES:
- You receive the news item in English (original source language).
- Your callback_suggestion MUST be written in Persian/Farsi.
- Only suggest a callback if it genuinely enriches the new post. Do not force connections.
- A callback should feel like a natural "as we reported earlier" or "this follows the pattern we noted" -- never mechanical.`;

    const tool = {
      name: 'find_narrative_thread',
      description: 'Report whether this story connects to recent coverage',
      parameters: {
        type: 'object',
        properties: {
          has_callback: { type: 'boolean', description: 'Whether a reference to past coverage is warranted' },
          callback_type: { type: 'string', enum: ['continuation', 'validation', 'contradiction', 'thematic', 'null'], description: 'Type of narrative connection, or "null" if none' },
          callback_suggestion: { type: 'string', description: 'A natural Persian phrase for referencing the prior post (e.g. "همونطور که قبلا گفتیم..."). Empty if none.' },
          referenced_post_id: { type: 'string', description: 'The tweet_id of the referenced post, or empty if none' },
          narrative_summary: { type: 'string', description: 'One sentence in English summarizing the ongoing narrative thread (internal use)' },
        },
        required: ['has_callback', 'callback_type'],
      },
    };

    const resp = await callOpenAI({
      apiKey,
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `NEW STORY (English original):\n${textOriginal}\n\nRECENT POSTS we published (last ${config.archivist_lookback_days} days):\n${postsContext}` },
      ],
      tool,
      maxOutputTokens: config.max_archivist_tokens,
      topP: randomTopP(),
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
    const systemPrompt = `${config.researcher_prompt}

IMPORTANT RULES:
- The news item is provided in English. Research in English for best results.
- Return all text fields (background_summary, key_facts, related_events) in ENGLISH.
  The downstream agents will handle the Persian translation.
- Focus on factual context: who, what, when, where, why.
- Prioritize recent events (last 7 days) and their direct predecessors.
- Include specific numbers, dates, and names when available.`;

    const tool = {
      name: 'provide_background',
      description: 'Return structured background research for this news item',
      parameters: {
        type: 'object',
        properties: {
          background_summary: { type: 'string', description: '2-3 sentences of essential context (in English)' },
          key_facts: { type: 'array', items: { type: 'string' }, description: 'Array of specific factual bullet points with dates/numbers (in English)' },
          related_events: { type: 'string', description: 'What led to this, what happened before (in English)' },
          sources: { type: 'array', items: { type: 'string' }, description: 'URLs consulted during research' },
        },
        required: ['background_summary', 'key_facts', 'related_events', 'sources'],
      },
    };

    const resp = await callOpenAI({
      apiKey,
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
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
async function runAnalyst(apiKey: string, config: EnrichmentConfig, textOriginal: string, textTranslated: string, archivist: ArchivistOutput | null, researcher: ResearcherOutput | null, styleModifier: string): Promise<{ output: AnalystOutput; usage: number }> {
  const contextParts: string[] = [];
  contextParts.push(`NEWS ITEM (English original):\n${textOriginal}`);

  if (researcher) {
    contextParts.push(`BACKGROUND RESEARCH (English):\n${researcher.background_summary}\nKey facts:\n${researcher.key_facts.map(f => `• ${f}`).join('\n')}`);
  }
  if (archivist?.has_callback && archivist.callback_suggestion) {
    contextParts.push(`NARRATIVE CALLBACK AVAILABLE:\nType: ${archivist.callback_type}\nSuggested Persian phrasing: ${archivist.callback_suggestion}\nContext: ${archivist.narrative_summary}\n\nIncorporate this callback ONLY if it genuinely adds value. Do not force it.`);
  }

  const systemPrompt = `${config.analyst_prompt}

CRITICAL INSTRUCTIONS:
- You receive the news in ENGLISH for precision. Read it carefully.
- ALL your output (commentary, hook, question) MUST be written in PERSIAN/FARSI.
- Your commentary should feel like a real person's sharp take -- not a news summary.
- The hook is the first thing readers see. Make it grab attention.
- Style direction for THIS post: ${styleModifier}
- Never start with "در خبری..." or "طبق گزارش..." -- these are AI-tells.
- Never use "قابل توجه است که" or "جالب است که" -- banned phrases.
- Vary your sentence structure. Mix short punchy sentences with longer analytical ones.`;

  const tool = {
    name: 'compose_analysis',
    description: 'Return editorial commentary for this news item',
    parameters: {
      type: 'object',
      properties: {
        commentary: { type: 'string', description: '2-4 sentences of sharp editorial analysis in PERSIAN' },
        hook: { type: 'string', description: 'A compelling attention-grabbing opening line in PERSIAN (not a summary)' },
        suggested_question: { type: 'string', description: 'Optional provocative question in PERSIAN to drive engagement, or empty' },
        uses_callback: { type: 'boolean', description: 'Whether the narrative callback was incorporated' },
        significance: { type: 'string', description: 'One sentence on why this matters (English, internal use only)' },
      },
      required: ['commentary', 'hook', 'uses_callback', 'significance'],
    },
  };

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextParts.join('\n\n---\n\n') },
    ],
    tool,
    maxOutputTokens: config.max_analysis_tokens,
    topP: randomTopP(),
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
async function runHumanizer(apiKey: string, config: EnrichmentConfig, voiceSamples: VoiceSamples, analyst: AnalystOutput, styleModifier: string): Promise<{ output: HumanizerOutput; usage: number }> {
  const samplesBlock = voiceSamples.samples.length > 0
    ? `\n\nVOICE SAMPLES (real tweets from this author -- match this style):\n${voiceSamples.samples.map((s, i) => `[${i + 1}] ${s}`).join('\n')}`
    : '';

  const systemPrompt = `${config.humanizer_prompt}
${samplesBlock}

CRITICAL INSTRUCTIONS:
- Input is in PERSIAN. Output MUST remain in PERSIAN.
- Your job: make AI-generated text sound like a human wrote it on their phone.
- Style direction for THIS post: ${styleModifier}

ANTI-AI-DETECTION TECHNIQUES (apply at least 3):
1. Vary sentence lengths aggressively (mix 3-word fragments with longer ones)
2. Use colloquial contractions: اینکه, همونطور, ینی, اصن
3. Occasionally skip formal connecting words -- use dashes or ellipses instead
4. Add ONE natural imperfection: a casual aside, a parenthetical thought, or an interrupted structure
5. Never use: "قابل توجه", "جالب است", "در همین راستا", "لازم به ذکر است"
6. Occasionally use informal punctuation: ... or !? or --
7. If the text sounds like a news anchor, rewrite it to sound like a sharp friend texting`;

  const tool = {
    name: 'humanize_text',
    description: 'Return the humanized version of the commentary',
    parameters: {
      type: 'object',
      properties: {
        humanized_commentary: { type: 'string', description: 'The rewritten commentary matching the author voice (PERSIAN)' },
        humanized_hook: { type: 'string', description: 'The rewritten hook (PERSIAN)' },
        humanized_question: { type: 'string', description: 'The rewritten question (PERSIAN), or empty if none' },
        changes_made: { type: 'string', description: 'Brief English note on what was changed (internal)' },
      },
      required: ['humanized_commentary', 'humanized_hook', 'changes_made'],
    },
  };

  const userContent = `Rewrite this to sound authentically human. Keep the meaning but change the texture:\n\nCommentary: ${analyst.commentary}\nHook: ${analyst.hook}${analyst.suggested_question ? `\nQuestion: ${analyst.suggested_question}` : ''}`;

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    tool,
    maxOutputTokens: config.max_humanizer_tokens,
    topP: randomTopP(),
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
async function runComposer(apiKey: string, config: EnrichmentConfig, textTranslated: string, humanizer: HumanizerOutput, archivist: ArchivistOutput | null, researcher: ResearcherOutput | null, previousFormatUsed: string | null, styleModifier: string): Promise<{ output: ComposerOutput; usage: number }> {
  const components: string[] = [];
  components.push(`TRANSLATED NEWS (Persian -- this is the core content to include):\n${textTranslated}`);
  components.push(`COMMENTARY (Persian): ${humanizer.humanized_commentary}`);
  components.push(`HOOK (Persian): ${humanizer.humanized_hook}`);
  if (humanizer.humanized_question) components.push(`QUESTION (Persian): ${humanizer.humanized_question}`);
  if (archivist?.has_callback && archivist.callback_suggestion) {
    components.push(`NARRATIVE CALLBACK (Persian): ${archivist.callback_suggestion}`);
  }
  if (researcher?.background_summary) {
    components.push(`BACKGROUND (English, for context only -- do not include verbatim): ${researcher.background_summary}`);
  }

  const avoidFormats: string[] = [];
  if (previousFormatUsed) avoidFormats.push(previousFormatUsed);

  const systemPrompt = `${config.composer_prompt}

CRITICAL INSTRUCTIONS:
- The final post MUST be in PERSIAN/FARSI.
- You are assembling components into ONE cohesive X post (max 280 chars for main tweet).
- The translation is the core news content. Commentary/hook enhance it -- they don't replace it.
- Style direction: ${styleModifier}
${avoidFormats.length > 0 ? `- DO NOT use format "${avoidFormats.join('" or "')}" -- pick something different.` : ''}

FORMAT OPTIONS (choose the one that fits this content best):
- analysis_lead: Start with your analytical take, then the news
- question_hook: Open with a provocative question, then the news + take
- context_first: Brief context, then news, then your reaction
- callback_lead: Reference a prior story, then show how this connects
- quote_style: Pull a key quote/number, then react
- plain: News + short reaction (no tricks, just clean delivery)
- thread_hook: Compelling first tweet + thread continuation for complex stories

VARIETY IS CRITICAL. Each post should feel structurally different from the last.`;

  const tool = {
    name: 'compose_post',
    description: 'Assemble the final X post from the provided components',
    parameters: {
      type: 'object',
      properties: {
        final_text: { type: 'string', description: 'The assembled post in PERSIAN ready for X (max 280 chars for main tweet)' },
        format_used: { type: 'string', enum: ['analysis_lead', 'question_hook', 'context_first', 'callback_lead', 'quote_style', 'plain', 'thread_hook'], description: 'Which format was chosen' },
        thread_continuation: { type: 'string', description: 'Second tweet text in PERSIAN if thread format, or empty' },
      },
      required: ['final_text', 'format_used'],
    },
  };

  const resp = await callOpenAI({
    apiKey,
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: components.join('\n\n') },
    ],
    tool,
    maxOutputTokens: config.max_composer_tokens,
    topP: randomTopP(),
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
