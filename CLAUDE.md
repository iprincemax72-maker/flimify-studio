# Flimify Studio — project notes (read this first)

Standalone AI-native video editor (Premiere-like layout) that is a **1:1 port of
the user's Premiere CEP extension** (`~/All Claude Work/claude-extension-premiere-pro-2026`).
Runs **desktop** (Electron) and **web** (`npm run web` → http://localhost:3939/app).

## Hard rules / facts to REMEMBER
- **No API key, ever.** Generation runs on the user's **own local Claude CLI**
  (the studio-bridge spawns `claude`). Never add an API-key path.
- **Website URLs** (flimify.com):
  - Account management page = **`https://www.flimify.com/account.html`**
    (NOT `/account`, NOT `/login` — those 404).
  - Site root = `https://www.flimify.com`. Pricing = `/#pricing`.
- The whole app should match the extension 1:1 (look + features). When in doubt,
  go read the extension's `extension/com.claudebridge.panel/index.html`.

## Architecture
- Frontend: Vite + React + TS + @remotion/player. The timeline IS a Remotion
  composition (preview == export). Entry `src/App.tsx`; AI panel
  `src/panels/FlimifyPanel.tsx`.
- Backend: `studio-bridge/server.cjs` (Node HTTP on **:3939**). Electron main
  spawns it (`ELECTRON_RUN_AS_NODE`). In web mode it also serves `dist/` at
  `/app` and accepts browser uploads (`/upload`).
- Render project reused from `~/PremiereClaude/remotion-intro`.

## Key bridge endpoints
`/health /media/:id /thumb/:id /import /upload /generate /cancel /export
/caption /autoedit/analyze /autoedit/run /expand /plan/questions
/progress-stream(SSE) /auth/status /auth/signin /auth/signout /connect /app`

## Conventions
- Commit as: `git -c user.name="Flimify" -c user.email="admin@cruxdev.in"`.
- Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Rebuild desktop app: `npm run build && npx electron-builder --mac --dir`,
  then `open "release/mac-arm64/Flimify Studio.app"`.
- Verify changes with Playwright against the dev server (localhost:5191) or the
  web build (localhost:3939/app).

## Account / sign-in (REAL Google via Supabase — don't break this)
- Studio reuses the **same Supabase project as the Premiere extension**:
  - URL `https://hwsyaqmkwitxprtnrzkj.supabase.co`, anon/publishable key
    `sb_publishable_k7tsIqZia0WXf4eGQwcY2w_jFjAkDEK` (public, safe to embed).
  - Owner emails: `iprincemax72@gmail.com`, `anshdhakad9@gmail.com` (→ owner, ∞).
- The bridge **auto-reads the extension's session** (`~/PremiereClaude/session.json`)
  so if you're signed into the extension you're signed into Studio — real name +
  **Google avatar** (`user_metadata.avatar_url`) + owner.
- Fresh sign-in: account button → opens `http://localhost:3939/connect` (the
  bridge serves a Supabase Google-OAuth page) → captures session to
  `~/FlimifyStudio/session.json`. For this to complete, Supabase **Redirect URLs
  must include `http://localhost:3939/connect`** (the extension's is `:3737`).
- The dashboard/manage link text is **"Dashboard"**, URL `…/account.html`.
- sign-in is optional — no blocking login wall on desktop.

## Plan gating — STRICT owner allowlist (do NOT loosen)
- **ONLY** the two `OWNER_EMAILS` (`iprincemax72@gmail.com`, `anshdhakad9@gmail.com`)
  are `owner` → `plan: 'studio'`, `unlimited: true` (∞ renders), and **every**
  feature unlocked (Auto-Edit, Captions, engine switch, all versions).
- **Every other account** — signed in or not, whatever its Supabase plan — is
  `plan: 'free'`: `unlimited: false`, render limit 5, and features LOCKED
  (Auto-Edit/Captions show 🔒 + upsell). NO account other than the two owners is
  ever elevated; there is **no `my_usage`/Supabase-plan path that grants access**
  (`resolvePlan` is a pure owner-vs-free check). Don't add infinite renders for
  everyone. `unlimited` is `owner`, never `true` blanket.

## Auto-update (desktop) — you usually DON'T repackage
- The packaged app loads its **frontend (dist) + bridge (server.cjs) from a
  writable overlay** `~/FlimifyStudio/app/`, seeded from the bundle on first run,
  then auto-synced from this repo (`FLIMIFY_UPDATE_SOURCE`, default
  `~/All Claude Work/flimify-studio`). It polls every 45s and **hot-reloads**.
- **To ship a fix:** edit the repo + `npm run build` (and/or edit
  `studio-bridge/server.cjs`). The running app picks it up within ~45s, reloads
  the window (toast "Updated…"), and restarts the bridge if it changed. **No
  `electron-builder`, no re-download.** Help → "Check for Updates…" forces it.
- **Only changes to `electron/main.cjs` or `electron/preload.cjs`** need a real
  `npx electron-builder --mac --dir` + relaunch (they load from the bundle).

## Security
- The user pasted API keys in chat earlier (Hera, Submagic). NEVER persist or
  commit secrets; advise rotating them.
