# lichess-lines

Personal Lichess opening explorer. Shows the most common lines you face across your accounts, with W/D/L from your perspective.

Backed by Lichess's [player opening explorer](https://explorer.lichess.org/player) — clicking a move drills into that line.

## Stack

- Cloudflare Workers + Hono
- Static `index.html` served via Workers Assets (no build step)

## Setup

1. `npm install`
2. Edit `wrangler.jsonc` and set `LICHESS_USERS` to your comma-separated usernames:
   ```jsonc
   "vars": { "LICHESS_USERS": "yourname1,yourname2" }
   ```
3. `npm run dev` — opens at http://localhost:8787
4. `npm run deploy` — pushes to Cloudflare (run `npx wrangler login` once first)

## Use

- Click a preset (Italian, Caro-Kann, etc.) to jump to that position
- Click any move in the table to descend into that line
- Click a move in the breadcrumb to truncate back to it
- Filter by speeds / modes / since-month at the top

## Endpoints

- `GET /api/users` — configured usernames
- `GET /api/explorer?color=white&play=e2e4,e7e5&speeds=blitz,rapid&modes=rated&since=2024-01`
  - Calls explorer.lichess.org once per configured user, sums totals and per-move stats
