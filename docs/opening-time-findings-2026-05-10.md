# Opening time findings — 2026-05-10

First end-to-end run of the opening-time / repertoire-gap heuristic against my last 242 lichess games (bradymem + junkvolume, blitz + rapid, ratings ~1250-1350).

## Where the code lives

Implementation is in **chess-trainer** (separate Python project, `~/Code/_archive/chess-trainer`):

- Module: `src/chess_trainer/opening_time.py`
- Command: `chess-trainer opening-time` → writes `reports/opening_time.{md,json}`
- Method: walks each game's user moves through ply 30, queries the Lichess explorer at rating band `1200,1400`, flags `in_book` (≥100 peer games + ≥40% top-reply popularity), `slow_book` (≥10s spent on a known position), `wrong_book` (deviated from top peer reply).

## Headline numbers

| Metric | Value |
|---|---:|
| Games analyzed | 242 |
| Avg ply where book runs out | 14.2 (~7 full moves) |
| Avg seconds spent in book | 26.8s |
| Total slow book moves | 191 |
| Total wrong book moves | 463 |

## The point of the report — result-independent gap

The whole motivation for this heuristic was: *can we detect opening prep gaps even when I win the game?* Answer: yes, very clearly.

| Bucket | Games | Avg time-in-book (s) | Avg slow book moves | Avg wrong book moves |
|---|---:|---:|---:|---:|
| Won  | 121 | 27.7 | 0.8 | 1.9 |
| Lost | 107 | 26.5 | 0.9 | 1.9 |

The opening prep gap is essentially identical whether I win or lose. So winning is not evidence I knew the opening — it just means something else went my way later.

## Genuinely interesting recurring leaks

Filtered down to positions inside my actual repertoire (Italian / Caro-Kann), where the "wrong book" signal isn't just noise from repertoire choice:

- **×12** Italian after `1.e4 e5 2.Nf3 Nc6` — peers play `Bc4` 42% of the time, I didn't. Either I'm hesitating on the main move, or sometimes switching openings.
- **×7** Caro-Kann Exchange after `2...d5` — peers play `exd5` 57%, I didn't.
- **×6** Caro-Kann Two Knights after `4.Nxe4` — peers play `Bf5` 58% (Botvinnik-Carls / main line), I didn't.

## Worst games

The "worst games" list (most slow + wrong book moves combined) is dominated by **Caro-Kann variations**: Two Knights Mindeno, Botvinnik-Carls, Tartakower, Panov.

→ **Black prep is leakier than White prep.** Worth a by-color split next run to quantify.

Specific games for resume reference:

- [iK4GlFm8](https://lichess.org/iK4GlFm8) — White, Caro-Kann Two Knights Mindeno (lost): 3 slow, 6 wrong, left book ply 21
- [jT4YZdFf](https://lichess.org/jT4YZdFf) — Black, Blackmar-Diemer Gambit Accepted (won): 4 slow, 4 wrong, left book ply 18
- [HKD7kAz5](https://lichess.org/HKD7kAz5) — Black, Caro-Kann Advance, Botvinnik-Carls (lost): 4 slow, 3 wrong, left book ply 20
- [BVm6tgvf](https://lichess.org/BVm6tgvf) — White, Italian Giuoco Pianissimo (lost): 2 slow, 5 wrong, left book ply 21
- [fiVtfc1u](https://lichess.org/fiVtfc1u) — Black, Caro-Kann Two Knights (lost): 3 slow, 4 wrong, left book ply 20

## Caveats / known noise in this run

- **`wrong_book` conflates repertoire choice with ignorance.** The top "leak" in the raw report is "×49 expected `e5` after 1.e4" — that's not a gap, that's correctly playing Caro-Kann. Same noise on Sicilian (1...c5 vs e5) and the Englund (1.d4 e5 instead of d5). Filtering plies 0/1, or filtering by my declared repertoire (Italian / Caro-Kann), would clean this up.
- **`slow_book` is the more reliable signal.** It fires on `in_book AND time_spent ≥ 10s` regardless of whether I played the popular move — repertoire choice doesn't pollute it.
- The rating band used was `1200,1400` (peers in 1200-1599). My rating is closer to 1300 — band is reasonable but slightly skews toward weaker theory.

## Operational notes (so the next run is less painful)

- **Lichess explorer now requires an OAuth token.** Endpoint moved from `explorer.lichess.ovh` → `explorer.lichess.org` and is OAuth-gated. Token created at <https://lichess.org/account/oauth/token/create> with no scopes; lives in `_archive/chess-trainer/.env` as `LICHESS_TOKEN=lip_…`.
- **First run was slow** — ~30 min for 242 games. Bottleneck is lichess server response (~300ms per cache miss); the polite `time.sleep(0.15)` between requests doubles that. Subsequent runs are near-instant if the corpus hasn't grown — `_archive/chess-trainer/data/explorer_cache.json` persists per-position responses.
- **Cache flushes only at end** of the run (in-memory until `finally`). If interrupted partway, all explorer fetches are lost. Worth adding periodic flushing if I run frequently or against larger corpora.

## Next-step options

In rough order of effort vs. payoff:

1. **Filter `wrong_book` by declared repertoire** (Italian / Caro-Kann) so the leak list stops surfacing repertoire choice as "wrong." Quickest fix; immediately makes the report actionable.
2. **By-color split** (`--color white|black|both`). Confirm the Black-leakier-than-White hunch quantitatively.
3. **Periodic cache flushing** in `opening_time.py` so interrupted runs are recoverable.
4. **Drill into Caro-Kann Two Knights / Advance variations** specifically — these dominate the worst-game list. Could be a `chess-trainer opening-time --opening C12` style filter or just a manual study session driven by the FEN list.

## Why this doc lives in lichess-lines, not chess-trainer

The analysis pipeline lives in chess-trainer. But the *output* of these runs — what I actually want to act on as a player — is conceptually closer to lichess-lines (my opening-explorer tool). Keeping findings here means I look at them when I'm in the "studying openings" headspace, not the "writing analysis code" headspace.
