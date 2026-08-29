# AGENTS.md

## Cursor Cloud specific instructions

Aurisar is an RPG-powered fitness tracker: a React 19 + Vite single-page app
(`aurisar-app`) deployed on Netlify. The core product is the fitness tracker
(log workouts/exercises, earn XP, level up, quests, leaderboards, trends). A
secondary "World" feature (`src/features/world/`) is a Babylon.js 3D/2D
multiplayer world backed by SpacetimeDB.

### Services and how to run them

The only service you must start locally for the core product is the Vite dev
server. Backends default to hosted/managed services (see below), so no local
database or auth stack is required.

| Service | Required? | Command | Notes |
|---|---|---|---|
| Vite dev server (the app) | Required | `pnpm run dev` | Port `5173`, `strictPort` (fixed). `predev` auto-runs `sync:terrain-assets`. |
| Supabase (auth + data) | Remote by default | none | `src/utils/supabase.js` has a hardcoded live project URL + anon key, so login/data work with zero setup. Override with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. |
| SpacetimeDB (World multiplayer) | Optional | none (uses remote maincloud) | Client bindings are committed; the World renders against `wss://maincloud.spacetimedb.com`. Only needed locally to modify/publish the module in `spacetimedb/`, which requires the external `spacetime` CLI (not installed by default). |
| Netlify Functions (`/api/*`) | Optional | `netlify dev` | Powers admin panel, WHOOP OAuth, Resend emails, GitHub issue creation. Needs the Netlify CLI + function secrets. Core logging/XP/leaderboards do not need these. |

### Testing the core product without real credentials

Use dev **Preview Mode** to test the fitness tracker end-to-end without signing
up: on the login screen click "Preview Mode" and enter the dev PIN `1234`
(overridable via `VITE_PREVIEW_PIN`). This loads a demo account with sample
data so you can build/log a one-off workout and see XP gained. Preview Mode is
dev-only (`import.meta.env.DEV`) unless `VITE_ALLOW_PREVIEW=true` at build time.

### Preview/branch deploy access gate

Public non-production Netlify deploys (`deploy-preview`, `branch-deploy`) are
gated by a server-side HTTP Basic Auth edge function,
`netlify/edge-functions/preview-auth.js`. It reads server-side (non-`VITE_`)
env vars `PREVIEW_BASIC_AUTH_USER` / `PREVIEW_BASIC_AUTH_PASSWORD`, so the
credential never reaches the client bundle. Non-obvious behavior:

- Production and local dev are **never** gated. The deploy context is read at
  runtime from `context.deploy.context` (the build-time `CONTEXT` env var is
  NOT available to edge functions at runtime), so `pnpm run dev` is unaffected.
  To exercise the gate locally, run through Netlify's edge runtime with a gated
  context, e.g. `netlify dev --context deploy-preview`, with both credential
  vars set.
- Because the gate is decided in code, the credential env vars can be set as
  plain, all-context Netlify variables — no per-deploy-context scoping needed.
  (If your plan exposes variable scopes, include the **Functions** scope so the
  edge function can read them.)
- On a gated deploy with the vars unset, the edge function returns `503`
  (fails closed) rather than serving an unprotected site.
- The client-side "Preview Mode" PIN is a dev convenience only — it is not a
  security boundary and cannot be kept secret in a public bundle.

### Lint / test / build

Standard scripts live in `package.json`. Non-obvious notes:

- **Package manager: pnpm.** Pinned by the `packageManager` field in
  `package.json` (root) and `spacetimedb/package.json` (a fully separate
  install with its own lockfile — not a shared workspace). Use `pnpm install`,
  never `npm install`; do not commit a `package-lock.json`.
- **Node version:** CI pins Node 22 in both workflows (`ci.yml`,
  `spacetime-publish.yml`).
- **Windows checkouts:** generated outputs that a `*:check` gate byte-compares are
  pinned `text eol=lf` in `.gitattributes` (this now includes both
  `pnpm-lock.yaml` files). If you add a new generated artifact with its own
  check gate, pin it there too — otherwise `core.autocrlf=true` rewrites it to
  CRLF on Windows and the gate fails with no real drift. CI runs ubuntu-latest
  and cannot catch this.
- `pnpm run lint` currently reports many pre-existing errors on `main` and is
  **not** run by CI — do not treat a red lint run as a regression you caused.
- CI (`.github/workflows/ci.yml`) gates on the freshness/determinism checks
  (`sync:content:check`, `emit:*:check`, `check:assets`, `vendor:meshopt:check`,
  `check:audio`, `sync:terrain-assets:check`, `verify:worldgen`), then
  `pnpm test` (Vitest) and `pnpm run build`. If you touch world/asset/content
  generators, run the matching `*:check` script and regenerate committed
  outputs, or CI will fail on drift.
- The build path is OFFLINE by design: terrain runtime maps are committed and
  `sync:terrain-assets` only verifies them against
  `config/terrain-assets.lock.json`. Terrain sources are downloaded solely via
  the explicit `pnpm run fetch:terrain-source <set-id>` (needed only when
  changing `config/terrain-assets.json`); commit the regenerated outputs + lock.
- `pnpm run build` can be memory-hungry; CI sets `NODE_OPTIONS=--max-old-space-size=4096`.
- There is no `.npmrc`. The one peer-dependency exception it used to carry
  (`eslint-plugin-jsx-a11y` vs ESLint 10) is now `peerDependencyRules` in
  `pnpm-workspace.yaml` — pnpm 11 reads project-level settings (peer rules,
  which build scripts run, supported platforms) from that file instead of
  `package.json`'s `pnpm` field. `spacetimedb/pnpm-workspace.yaml` carries no
  settings; it exists only to keep that install's workspace root from being
  discovered as this one's. **Neither file may ever gain a `packages:` key** —
  that would fold `spacetimedb/` into a shared workspace with the root
  install and silently break the two-separate-lockfiles design. Treat adding
  one as a review-blocking change, not a routine edit.

### Reviewing pull requests

When asked to review a PR, always **post the review as a comment on that PR**
(not only as a summary in chat) — this is a required deliverable for every
review. Verify claims against the actual code before posting: check out the PR
branch (an isolated `git worktree` avoids disturbing the current branch) and run
the relevant tests, `eslint` on the changed files, and any behavior-specific
checks, then include what you verified in the comment.
