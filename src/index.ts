import { Hono } from "hono";

type Env = {
  ASSETS: Fetcher;
  LICHESS_USERS: string;
};

type Opening = { eco: string; name: string } | null;

type ExplorerMove = {
  uci: string;
  san: string;
  averageOpponentRating: number;
  performance: number;
  white: number;
  draws: number;
  black: number;
  game: unknown;
  opening: Opening;
};

type ExplorerResponse = {
  opening: Opening;
  white: number;
  draws: number;
  black: number;
  moves: ExplorerMove[];
  recentGames: unknown[];
  queuePosition?: number;
};

type MergedMove = Omit<ExplorerMove, "game"> & { games: number };

type MergedResponse = {
  opening: Opening;
  white: number;
  draws: number;
  black: number;
  games: number;
  moves: MergedMove[];
  perUser: Record<string, { white: number; draws: number; black: number }>;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/api/users", (c) => {
  const users = c.env.LICHESS_USERS.split(",").map((s) => s.trim()).filter(Boolean);
  return c.json({ users });
});

app.get("/api/explorer", async (c) => {
  const users = c.env.LICHESS_USERS.split(",").map((s) => s.trim()).filter(Boolean);
  if (users.length === 0) {
    return c.json({ error: "No LICHESS_USERS configured" }, 500);
  }

  const color = c.req.query("color");
  if (color !== "white" && color !== "black") {
    return c.json({ error: "color must be 'white' or 'black'" }, 400);
  }

  const passthrough = ["play", "speeds", "modes", "since", "until", "variant", "moves"] as const;
  const baseParams = new URLSearchParams();
  baseParams.set("color", color);
  for (const key of passthrough) {
    const v = c.req.query(key);
    if (v !== undefined) baseParams.set(key, v);
  }

  const responses = await Promise.all(
    users.map(async (player) => {
      const params = new URLSearchParams(baseParams);
      params.set("player", player);
      params.set("recentGames", "0");
      const url = `https://explorer.lichess.org/player?${params.toString()}`;
      const res = await fetch(url, { headers: { Accept: "application/x-ndjson" } });
      if (!res.ok) {
        throw new Error(`Lichess explorer ${res.status} for ${player}`);
      }
      const text = await res.text();
      const last = text.split("\n").map((s) => s.trim()).filter(Boolean).at(-1);
      if (!last) throw new Error(`Empty response for ${player}`);
      return [player, JSON.parse(last) as ExplorerResponse] as const;
    }),
  );

  return c.json(merge(responses));
});

function merge(entries: readonly (readonly [string, ExplorerResponse])[]): MergedResponse {
  const perUser: MergedResponse["perUser"] = {};
  let white = 0, draws = 0, black = 0;
  let opening: Opening = null;
  const moveMap = new Map<string, MergedMove & { ratingSum: number; perfSum: number }>();

  for (const [user, r] of entries) {
    perUser[user] = { white: r.white, draws: r.draws, black: r.black };
    white += r.white;
    draws += r.draws;
    black += r.black;
    if (!opening && r.opening) opening = r.opening;

    for (const m of r.moves) {
      const games = m.white + m.draws + m.black;
      if (games === 0) continue;
      const existing = moveMap.get(m.uci);
      if (existing) {
        existing.white += m.white;
        existing.draws += m.draws;
        existing.black += m.black;
        existing.ratingSum += m.averageOpponentRating * games;
        existing.perfSum += m.performance * games;
        existing.games += games;
        if (!existing.opening && m.opening) existing.opening = m.opening;
      } else {
        moveMap.set(m.uci, {
          uci: m.uci,
          san: m.san,
          opening: m.opening,
          white: m.white,
          draws: m.draws,
          black: m.black,
          games,
          averageOpponentRating: m.averageOpponentRating,
          performance: m.performance,
          ratingSum: m.averageOpponentRating * games,
          perfSum: m.performance * games,
        });
      }
    }
  }

  const moves: MergedMove[] = [...moveMap.values()]
    .map((m) => ({
      uci: m.uci,
      san: m.san,
      opening: m.opening,
      white: m.white,
      draws: m.draws,
      black: m.black,
      games: m.games,
      averageOpponentRating: Math.round(m.ratingSum / m.games),
      performance: Math.round(m.perfSum / m.games),
    }))
    .sort((a, b) => b.games - a.games);

  return {
    opening,
    white,
    draws,
    black,
    games: white + draws + black,
    moves,
    perUser,
  };
}

export default app;
