

## How Scoring Works Today

Here's the exact prompt being sent to OpenAI (lines 356-368 of `worker/index.ts`):

```text
SYSTEM PROMPT:
"{your translation prompt from Settings}"

ADDITIONAL TASK: After translating, you MUST also call the
"classify_importance" tool to score this news item's importance
on a scale of 1-10.

Scoring guidelines from the editor:
{editorial_guidelines or "Use your best judgment for news importance."}

High-priority topics (boost score): {priority_topics or "none specified"}
Low-priority topics (lower score): {low_priority_topics or "none specified"}

Score 8-10: Major breaking news, critical geopolitical events...
Score 5-7: Notable news, regional events...
Score 1-4: Minor news, routine updates, entertainment, sports...
```

```text
USER MESSAGE:
"{raw tweet text — no author info, no context}"
```

The response is forced into a tool call (`classify_importance`) that returns `translated_text`, `importance_score`, `tags`, and `reasoning`.

## Problems

1. **Task dilution** — The model is told "you are a translator" then asked to also score importance. Two conflicting roles in one system prompt.
2. **No author context** — The model has no idea who tweeted. A military analyst and a sports blogger get the same treatment.
3. **Vague rubric** — "Major breaking news" vs "Notable news" is subjective. No concrete examples.
4. **No tweet metadata** — No URL, no publish date, no media info. The model scores blind.
5. **Editorial guidelines are unstructured** — Just a blob of text appended to the prompt with no framing.

## Plan: Restructure the Scoring Prompt

All changes are in **one file**: `supabase/functions/worker/index.ts`, lines 350-405.

### Change 1 — Separate the scoring role from translation

Instead of appending scoring as an afterthought to the translator prompt, give the system prompt a **dual-role structure** with clear sections:

```text
SYSTEM: You have two tasks:

## Task 1: Translation
{existing translation prompt}

## Task 2: News Importance Scoring
You are an editorial assistant scoring news for a Persian-language
Telegram channel focused on {context from guidelines}.

Score on a 1-10 scale using this rubric:
  9-10: Immediate breaking news...
  7-8:  Significant developments...
  5-6:  Noteworthy but not urgent...
  3-4:  Routine or tangential...
  1-2:  Irrelevant noise...

Editorial priorities:
{editorial_guidelines}
```

### Change 2 — Inject author context into the user message

Currently the user message is just the raw tweet text. Change it to:

```text
Author: @{handle} ({display_name})
Published: {tweeted_at}
Has media: {yes/no}
URL: {tweet_url}

Content:
{tweet text}
```

This lets the model weigh source credibility.

### Change 3 — Make the rubric concrete with anchor examples

Replace the vague 3-tier scale with a **5-tier rubric** with concrete anchor descriptions tied to the user's editorial focus:

| Score | Label | Description |
|-------|-------|-------------|
| 9-10 | Critical | Direct military action, major sanctions, leader assassinations, war escalation |
| 7-8 | Important | Diplomatic shifts, significant policy changes, major regional developments |
| 5-6 | Noteworthy | Notable statements, economic data with geopolitical implications |
| 3-4 | Low interest | Routine updates, minor economic data, peripheral coverage |
| 1-2 | Skip | Entertainment, sports, celebrity gossip, memes |

### Change 4 — Frame editorial guidelines properly

Instead of dumping `editorial_guidelines` as raw text, wrap it:

```text
The editor has provided these specific guidelines for scoring.
Treat these as authoritative overrides to the default rubric:
---
{editorial_guidelines}
---
```

### Change 5 — Add `reasoning` as required field

Currently `reasoning` is optional in the tool schema. Make it required so we always get an explanation — useful for debugging scores in the Monitoring page.

## Summary of changes

- **1 file modified**: `supabase/functions/worker/index.ts` (the translate job section, ~60 lines)
- **No database changes**
- **No UI changes** (reasoning will show automatically if already displayed in Monitoring)
- **No new API calls** — same single call, just a better prompt
- **Redeploy** the worker edge function after changes

