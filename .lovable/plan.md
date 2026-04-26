## X Downloader Tab

Add a new sidebar tab and route that lets the user paste an X/Twitter post URL and download its media (images/videos/GIFs) directly in the browser. No backend, no database — pure client-side using the public `api.vxtwitter.com` proxy.

### What gets built

1. **New route** `/downloader` in `src/App.tsx` (lazy-loaded under `AppLayout`, matching existing pages).
2. **New sidebar entry** "Downloader" in `src/components/layout/AppSidebar.tsx` using the `Download` icon from lucide-react.
3. **New page** `src/pages/Downloader.tsx` adapted from the user's Gemini canvas sample, rewritten to:
   - Use TypeScript with proper types for the vxtwitter response (`user_name`, `user_screen_name`, `user_profile_image_url`, `tweetID`, `media_extended[]` with `url`, `type`, `thumbnail_url`).
   - Use existing shadcn primitives (`Card`, `Input`, `Button`, `Alert`, `Badge`, `Avatar`) and the project's glass/dark theme tokens (`glass-button`, `bg-card`, `text-muted-foreground`, `border-glass-border`) instead of raw Tailwind colors, so it matches the rest of the panel.
   - Validate URL with a regex for `twitter.com` / `x.com` `/status/<id>`.
   - Fetch `https://api.vxtwitter.com/{username}/status/{id}`, show a loading state, surface errors via toast + inline alert.
   - Render an author header (avatar + name + @handle) and a responsive media grid (1 col on mobile, 2 cols when >1 item).
   - Each media card has a thumbnail/video preview, a type badge (Video / Image / GIF), a "Download File" button (Blob fetch + `<a download>` with CORS-safe fallback to `window.open`), and an "Open Direct Link" button.

### Technical notes

- File names: `x_media_{screen_name}_{tweetID}_{index}.{mp4|jpg}`.
- No new dependencies — `lucide-react`, `react`, shadcn UI are already present.
- No env vars or Supabase changes needed; this is a 100% client-side feature.
- Keep the existing sidebar order; insert "Downloader" between "My X" and "Settings".

### Files changed

- `src/App.tsx` — add lazy import + route.
- `src/components/layout/AppSidebar.tsx` — add nav item.
- `src/pages/Downloader.tsx` — new page (the downloader UI).
