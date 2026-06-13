# Flimify Studio — deploy as a website (flimify.com)

The bridge now serves a **complete website**, not just the editor:

| URL | Serves |
|-----|--------|
| `/` | **Landing + download page** (`public/landing.html`) — hero, feature cards, OS-detected "Download for Mac/Windows", and "Open in browser". |
| `/app` | The **web editor** (the full app — same `dist/`). |
| `/download/mac` | Newest `.dmg` from `downloads/` (streamed as an attachment). |
| `/download/win` | Newest `.exe` from `downloads/`. |

So a visitor hits `flimify.com`, sees the product + can **download the Mac/Windows
app OR open the editor in their browser** — all from one deploy.

**Getting the installers onto the site:** build them (`npm run dist:mac` /
`npm run dist:win`, or both on this Mac with `npx electron-builder --mac --win`),
then drop the `.dmg` + `.exe` into a **`downloads/`** folder next to the bridge
(override the path with `FLIMIFY_DOWNLOADS_DIR`). The bridge serves the newest of
each automatically — no code change to ship a new build. (Big files: for real
traffic, host the installers on a CDN / object storage and point the two
`/download/*` links there instead.)

The frontend talks to its backend at the **same origin** (`src/api.ts`), so the
exact same build works behind any host. What's left is **where to run the
backend** and **how to point flimify.com at it**.

> **The website IS the desktop app — same `dist/`.** Every editor feature ships in
> this one build, so the site automatically has all of it: timeline **zoom**
> (Alt+scroll) + **Fit**, **Shift+scroll** horizontal pan, the **particle**
> background, **theme-aware** track labels, and the overscroll/nav guards. Nothing
> extra to "port to the web" — `npm run build` once, serve `dist/`, done. (Verified
> in web mode: particles, the −/Fit/+ toolbar, themed labels, same-origin API.)
>
> A ready-made branded entry point lives at **`public/launch.html`** → `dist/launch.html`.
> Set its `EDITOR_URL`, host it at `flimify.com/launch` (or link the URL directly),
> and it forwards visitors into the editor — see §3.

> You do NOT need to buy a domain. Use a free **subdomain** (`app.flimify.com`)
> or a **path** (`flimify.com/editor`) — both are free under flimify.com.

---

## How it works

```
visitor ─► app.flimify.com (or flimify.com/editor)
              │  serves the built editor (dist) at /app
              │  + the API at /generate /upload /export /caption /auth/* …
              ▼
        studio-bridge (Node)  ──spawns──►  claude CLI  (auth = ANTHROPIC_API_KEY)
                              ──spawns──►  ffmpeg + Remotion render
```

On the **desktop app** the bridge spawns your local `claude` (subscription, no
key). On a **server** there's no per-visitor CLI, so the same bridge runs `claude`
authenticated with a server-side **`ANTHROPIC_API_KEY`** — your decision. The key
lives only on the server; it is never sent to the browser.

---

## 1. Host the backend (the bridge)

Use a host that runs a **long-lived Node process** and lets you install binaries.
Vercel/Netlify (serverless) WON'T work — they can't run `claude`/`ffmpeg`/Remotion.
Good options: a small **VPS** (Hetzner/DigitalOcean, ~$5–10/mo), **Render**,
**Railway**, or **Fly.io**.

On that host:

```bash
# 1. deps
#   - Node 20+
#   - ffmpeg            (apt-get install ffmpeg  /  brew install ffmpeg)
#   - the Claude CLI:   npm i -g @anthropic-ai/claude-code
# 2. the app
git clone <this repo> flimify-studio && cd flimify-studio
npm ci
npm run build                      # → dist/
# 3. a Remotion render project must exist (the bridge renders into it).
#    Point FLIMIFY_RENDER_PROJECT at a Remotion project with node_modules ready
#    (copy ~/PremiereClaude/remotion-intro, or scaffold a fresh `npx create-video`).
# 4. run it
export ANTHROPIC_API_KEY=sk-ant-...        # server-side only
export FLIMIFY_RENDER_PROJECT=/srv/remotion-intro
export FLIMIFY_STUDIO_PORT=3939
node studio-bridge/server.cjs              # serves /app + the API on :3939
```

Put it behind your web server (nginx/Caddy) on 80/443, or let Render/Railway/Fly
terminate TLS. The editor is then at `https://<host>/app`.

## 2. Point flimify.com at it (no new domain)

**Option A — subdomain `app.flimify.com` (recommended, cleanest):**
- DNS: add a `CNAME app → <your host>` (free, in your existing DNS).
- The editor lives at `https://app.flimify.com/app` (API at the same origin — works
  out of the box because the frontend uses `location.origin`).

**Option B — path `flimify.com/editor`:**
- Reverse-proxy `/editor/*` → the bridge, preserving the path to `/app` and the
  API routes. nginx example:
  ```nginx
  location /editor/ { proxy_pass http://127.0.0.1:3939/app/; }
  location ~ ^/(generate|upload|export|caption|autoedit|auth|health|media|thumb|progress-stream|expand|plan|connect|cancel) {
    proxy_pass http://127.0.0.1:3939;
    proxy_set_header Host $host;
  }
  ```
  (Subdomain is simpler — no per-route proxying.)

## 3. Redirect people from flimify.com → the editor

Add a button on your landing page:

```html
<a href="https://app.flimify.com/app" class="cta">Open the editor →</a>
```

Or a dedicated redirect page (`flimify.com/launch`):

```html
<!doctype html><meta http-equiv="refresh" content="0; url=https://app.flimify.com/app">
<link rel="canonical" href="https://app.flimify.com/app">
<p>Opening the editor… <a href="https://app.flimify.com/app">click here</a>.</p>
```

## 4. Auth on the hosted domain

Google sign-in uses Supabase OAuth with a `/connect` redirect. For the hosted
site, add the hosted callback to **Supabase → Auth → URL Configuration → Redirect
URLs**:
```
https://app.flimify.com/connect
```
(That's the web equivalent of the desktop `http://localhost:3939/connect`.)

---

## ⚠ Before you open it to the PUBLIC — read this

The bridge was built **single-user** (your machine). For a multi-visitor website,
three things need work first — happy to build these next:

1. **Multi-tenancy / auth.** The bridge keeps ONE global session
   (`~/FlimifyStudio/session.json`) — fine for one owner, wrong for many users.
   Each request needs its own user token + isolated state, not a shared session.
2. **Abuse + cost control.** A public `/generate` backed by your `ANTHROPIC_API_KEY`
   means anyone can burn your credits. Needs sign-in-gating + per-user rate limits
   + the plan metering (free vs paid) actually enforced server-side.
3. **Render isolation.** Concurrent renders share one Remotion project + output
   dir. Per-request scratch dirs (the isolated-entry render already helps) + a job
   queue keep visitors from clashing.

**For your own use / a private demo today:** deploy as above with the API key and
it works immediately. **For a true public launch:** do #1–#3 first.
