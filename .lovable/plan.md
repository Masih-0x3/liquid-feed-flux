

## Problem Analysis

Your content filter has two weaknesses:

1. **Threshold too low (10/20)**: 62 posts at score 10 and 41 at score 11 are getting delivered — these are mostly non-Iran content (stock markets, Hungary politics, routine China diplomacy). Raising to **14** would cut delivered posts roughly in half, keeping only genuinely Iran/Middle East relevant content.

2. **Scoring prompt not Iran-focused enough**: The rubric treats all geopolitical news equally. A China ceasefire comment gets 13, same as an Iran sanctions story. The prompt needs to explicitly deprioritize non-Iran/Middle East content and give Iran-specific events a scoring boost.

## Proposed Changes

### 1. Raise default threshold from 10 to 14
Update the `content_filter` setting in the database. This alone would have blocked 103 low-relevance posts in the last 24h.

### 2. Strengthen the editorial guidelines
Replace the current editorial guidelines with a more explicit Iran-gate:

> "This channel is exclusively focused on Iran and the broader Middle East. Content MUST have a direct connection to Iran, its government, military, economy, sanctions, nuclear program, proxies, or regional conflicts involving Iran. General world news (e.g., US stocks, European politics, China domestic policy) should score 8 or below UNLESS it directly impacts Iran. Only deliver content that a dedicated Iran-watcher would find essential."

### 3. Update priority/low-priority topics
- **Priority topics**: Iran, IRGC, Hormuz, sanctions, nuclear, Hezbollah, Houthis, Israel-Iran, Persian Gulf, Middle East
- **Low-priority topics**: stocks, crypto, earnings, sports, entertainment, EU internal politics, US domestic, China domestic

### 4. Add a relevance gate to the scoring rubric
Add an explicit instruction in the worker's system prompt: "If the content has NO direct connection to Iran or the Middle East region, cap the score at 8 regardless of how important the event is globally."

## Technical Implementation

1. **Database migration**: Update the `content_filter` setting with new threshold (14), updated editorial guidelines, and expanded topic lists
2. **Worker edge function**: Add an Iran-relevance cap rule to the scoring system prompt (lines 357-386 of `worker/index.ts`) — a single paragraph addition telling the AI to cap non-Iran scores at 8
3. **Redeploy worker** function with the updated prompt

These changes work together: the prompt makes the AI score non-Iran content lower, the threshold filters out anything that still slips through, and the editorial guidelines provide authoritative overrides.

