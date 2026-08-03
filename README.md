# PTC Match Play

Golf match-play tournament app for **Peachtree Collective**. Admins set up tournaments; players enter scorecards from their phones; standings and brackets update live.

## What it does

**Public (players)**
- Pick an active tournament
- View pool standings (Pts / W / L / margin) and the knockout bracket
- Enter a scorecard hole-by-hole (blind until both sides submit)
- See match status: pending, awaiting opponent, disputed, or closed

**Admin (`#/admin`)**
- Password-gated setup and management
- Create pool+bracket or straight knockout tournaments
- Override results, resolve disputes, force-approve single submissions
- Archive finished tournaments
- Optional Discord webhook (app-wide): posts when a match is validated or overridden

Tournament data lives in **Supabase** (JSONB rows) with Realtime so open tabs stay in sync.

## Stack

- React 19 + Vite
- Supabase (`@supabase/supabase-js`) for storage + Realtime
- Hash routing: `/` public, `#/admin` admin

## Local setup

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.example` → `.env` and fill in:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `VITE_ADMIN_PASSWORD` | Password for the admin screen |

> **Note:** `VITE_*` values are bundled into the client. The admin password is a light gate, not server-side auth. Protect write access with Supabase RLS/grants as needed for your threat model.

### 3. Supabase table

Create a `tournaments` table the app can read/write with the anon key (at least for your intended roles):

| Column | Type | Notes |
|---|---|---|
| `id` | text (PK) | App uses `"main"` and `"archive"` |
| `state` | jsonb | `{ "tournaments": [ ... ] }` |
| `version` | integer | Optimistic locking on `main` |
| `updated_at` | timestamptz | Optional but useful |

Enable **Realtime** on `tournaments` so clients pick up changes.

Suggested starter rows (empty state is fine):

```sql
insert into tournaments (id, state, version)
values
  ('main', '{"tournaments":[]}', 0),
  ('archive', '{"tournaments":[]}', 0)
on conflict (id) do nothing;
```

### 4. Run

```bash
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Admin: add `#/admin` to the URL.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Oxlint |

## Deploy (Vercel)

1. Connect the GitHub repo to a Vercel project
2. Set the same `VITE_*` env vars in the Vercel project settings
3. Redeploy after env changes

Pushes to the connected branch build and publish automatically.

## Keep Supabase awake (Free tier)

Free projects pause after ~7 days with little API activity. This repo includes a GitHub Action (`.github/workflows/keep-supabase-alive.yml`) that pings the `tournaments` table twice a week.

**One-time setup** — GitHub repo → **Settings → Secrets and variables → Actions** → add:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL` |
| `SUPABASE_ANON_KEY` | Same as `VITE_SUPABASE_ANON_KEY` |

You can also run it manually from the **Actions** tab → **Keep Supabase Alive** → **Run workflow**.

## Discord notifications

Configure an app-wide Discord webhook in **Admin Panel** (commissioner home, above the tournament list).

- Stored on the main Supabase state as `discordWebhookUrl` (not an env var)
- Fires when a match transitions to **closed** (both sides agree, admin override, or force-approve)
- The webhook URL is client-readable (same model as other app data); treat the Discord channel as semi-public
- Per-tournament overrides are supported in code (`tournament.discordWebhookUrl`) but not exposed in the UI yet

## Project layout

```
src/
  App.jsx                 # Routing, load/save, Realtime
  components/
    PublicHome.jsx        # Public standings / matches / bracket
    AdminHome.jsx         # Tournament setup & admin tools
    ScorecardScreen.jsx   # Hole-by-hole score entry
    BracketView.jsx       # Visual knockout tree
    ...
  lib/
    engine.js             # Match-play math, pools, bracket advancement
    storage.js            # Supabase load/save + versioning
    discord.js            # Discord webhook notify on match close
    format.js             # Dates, labels, ids
    supabase.js           # Client
```

## How scoring works (short version)

- Each hole is won by side A, side B, or halved
- Match closes early when one side’s lead is greater than holes remaining (e.g. `3&2`), or after 18 (`1 UP` / `Halved`)
- Both sides submit scorecards; matching results validate, mismatches dispute
- Pool standings use **Pts** (3 win / 1 halve / 0 loss), then W, L, and win margin
- When pools finish, advancers fill a single-elim bracket

## Repo ownership notes

Canonical GitHub repo: `AddisonHicks/ptcmatchplay`.

If another org (e.g. PTC-Golf) hosts the Vercel project from a **fork**, sync their fork from this repo when you want updates (GitHub **Sync fork**, or pull `upstream` and push `origin`). Prefer linking Vercel directly to this repo when possible so deploys track `main` automatically.
