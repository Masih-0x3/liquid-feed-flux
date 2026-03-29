

## Current State

- **Scoring**: Fully deployed with 1-20 scale, 10-tier rubric, metadata enrichment, mandatory reasoning
- **Active?**: No — both `enabled` and `score_only` are **off** by default. You need to toggle one on in Settings and save
- **Default threshold bug**: The fallback in `useSettingsData.ts` still says `default_threshold: 6` (leftover from 1-10 scale) — should be `12`
- **Pipeline**: Complete. Worker handles: AI scoring → per-author rules → global threshold → deliver/skip

## UI Redesign: Intuitive Filter Mode Selection

Restructure the Content Filter settings into a cleaner flow with a **filter mode selector** instead of the current toggles.

### New Flow

```text
┌─────────────────────────────────────┐
│  Content Filtering                  │
│                                     │
│  [Off] [Score Only] [Active]  ← tab │
│                                     │
│  If Active:                         │
│  ┌─ Filter Mode ──────────────────┐ │
│  │ ○ Global Only                  │ │
│  │   All posts use one threshold  │ │
│  │                                │ │
│  │ ○ Granular (Per-Author)        │ │
│  │   Set rules per author +       │ │
│  │   global fallback              │ │
│  └────────────────────────────────┘ │
│                                     │
│  [Global threshold slider: 12/20]   │
│                                     │
│  If Granular selected:              │
│  ┌─ Per-Author Overrides ─────────┐ │
│  │ (collapsible author table)     │ │
│  └────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Changes

**File 1: `src/components/settings/ContentFilterSettings.tsx`**
- Replace the two separate Switch toggles (Enable / Score Only) with a **3-option radio group** or tab strip: Off | Score Only | Active
- Add a `filter_mode` field to config: `'global'` or `'granular'`
- When **Active** is selected, show a radio choice: "Global Only" vs "Granular (Per-Author)"
- Global threshold slider always shows when Active
- Per-Author table only renders when `filter_mode === 'granular'` — wrapped in a collapsible with smooth animation
- Editorial Guidelines section shows for both Score Only and Active modes (no change)

**File 2: `src/components/settings/ContentFilterSettings.tsx` (interface update)**
- Add `filter_mode?: 'global' | 'granular'` to `ContentFilterConfig`

**File 3: `src/hooks/useSettingsData.ts`**
- Fix `default_threshold` from `6` to `12` in defaults

**File 4: `supabase/functions/worker/index.ts`** (no change needed)
- The worker already ignores `author_rules` when none are set, so `filter_mode: 'global'` works implicitly — authors with no rules just use the global threshold

### Summary
- 2 files modified (`ContentFilterSettings.tsx`, `useSettingsData.ts`)
- No backend changes
- No database changes
- Adds `filter_mode` to config interface for UI control only

