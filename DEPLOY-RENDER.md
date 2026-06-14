# Flimify render backend — deploy guide

This stands up the **studio-bridge on a server** so the web editor
(`flimify.com/studio`) can do the things a browser can't: **generate, captions,
auto-edit, and mp4 export** (Claude + Remotion + ffmpeg). It serves both:

- the **API** the editor calls (`/health /generate /export /caption …`), and
- the **full editor** at `https://<your-host>/` (same-origin → works out of the box).

Everything is in this repo: `Dockerfile`, `render.yaml`, and the bundled render
project (`server/render-project/`).

---

## Deploy (Render — easiest)

1. Push this repo to GitHub (already is: `iprincemax72-maker/flimify-studio`).
2. Render.com → **New → Blueprint** → connect the repo. It reads `render.yaml`
   and builds the `Dockerfile` (first build ≈ 8–12 min — it installs Remotion,
   downloads a headless Chrome, and builds the app).
3. When prompted, set the one secret: **`ANTHROPIC_API_KEY`** = your Anthropic
   key (this is the server-side Claude the backend runs on).
4. It deploys to `https://flimify-render.onrender.com` (or your custom domain).
   Hit `https://<host>/health` — you should get `{ "ok": true, … }`.
5. Open `https://<host>/` — the **full editor**, fully working against that
   backend. 🎬

> **Railway / Fly / a VPS** work identically — they just build the `Dockerfile`.
> Set `ANTHROPIC_API_KEY`; the platform's `$PORT` is read automatically; the
> bridge binds `0.0.0.0` because the image sets `FLIMIFY_BIND_HOST=0.0.0.0`.

---

## Point flimify.com/studio at it

The editor at `flimify.com/studio` resolves its backend from
`window.__FLIMIFY_BRIDGE__` (set in `landing/studio/index.html`). Two modes:

- **You (testing):** leave it `http://localhost:3939` → your own desktop bridge.
- **Visitors:** set it to `https://<your-host>` → everyone uses the hosted backend.

(Tell me the host URL and I'll wire it — including a "local bridge first, hosted
fallback" resolver so your own machine still uses localhost.)

---

## Plan / cost

- **Memory:** rendering is chromium + ffmpeg — use **2 GB+** (`plan: standard`).
  512 MB will OOM mid-render.
- **Cost:** every render burns your `ANTHROPIC_API_KEY` (generation) + CPU
  (Remotion). A public endpoint = anyone can spend it — **gate it** (sign-in +
  per-user limits) before sharing widely. See "abuse" below.

## Known first-deploy gotchas (we'll iterate on the live logs)

1. **Claude headless auth.** The bridge runs `claude -p --permission-mode
   bypassPermissions`. With `ANTHROPIC_API_KEY` set this should run
   non-interactively; if the CLI asks for onboarding/trust on a fresh container,
   we add the skip env/flag. (Check `/health` first, then try a generate.)
2. **Remotion best-practices skills.** The generation system prompt references
   `~/.claude/skills/remotion-best-practices/…`, which aren't in the container.
   Generation still works (Claude knows Remotion); quality is a touch better with
   them — we can bake them in later.
3. **Memory/timeouts.** Long exports need RAM + a generous request timeout on the
   host.

## Abuse / multi-tenant (before a public launch)

The bridge was built single-user. A public `/generate` on your key = open wallet.
Before sharing: sign-in-gate the API, enforce per-user render limits, and isolate
concurrent renders. Happy to build these next.
