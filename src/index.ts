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

type UserStats = {
  white: number;
  draws: number;
  black: number;
  // Present while Lichess is still building the player's index.
  // > 0 = waiting in queue at that position; 0 = actively indexing (partial data).
  // Absent = fully indexed, totals are final.
  queuePosition?: number;
};

type MergedResponse = {
  opening: Opening;
  white: number;
  draws: number;
  black: number;
  games: number;
  moves: MergedMove[];
  perUser: Record<string, UserStats>;
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

  // Cache key strips ?fresh so a recheck and a normal call share the same slot.
  const reqUrl = new URL(c.req.url);
  const wantFresh = reqUrl.searchParams.get("fresh") === "1";
  reqUrl.searchParams.delete("fresh");
  const cache = caches.default;
  const cacheKey = new Request(reqUrl.toString(), { method: "GET" });

  if (!wantFresh) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
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
      const data = await fetchFirstNdjson(url);
      return [player, data] as const;
    }),
  );

  const merged = merge(responses);
  // Shorter TTL while Lichess is still indexing so the UI catches up.
  const isPartial = Object.values(merged.perUser).some((s) => s.queuePosition !== undefined);
  const ttl = isPartial ? 30 : 300;
  const response = new Response(JSON.stringify(merged), {
    headers: {
      "content-type": "application/json",
      "cache-control": `public, max-age=${ttl}`,
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

async function fetchFirstNdjson(url: string): Promise<ExplorerResponse> {
  const res = await fetch(url, { headers: { Accept: "application/x-ndjson" } });
  if (!res.ok || !res.body) throw new Error(`Lichess explorer ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) return JSON.parse(line) as ExplorerResponse;
      }
    }
    const tail = buffer.trim();
    if (tail) return JSON.parse(tail) as ExplorerResponse;
    throw new Error("Empty response from Lichess");
  } finally {
    reader.cancel().catch(() => {});
  }
}

function merge(entries: readonly (readonly [string, ExplorerResponse])[]): MergedResponse {
  const perUser: MergedResponse["perUser"] = {};
  let white = 0, draws = 0, black = 0;
  let opening: Opening = null;
  const moveMap = new Map<string, MergedMove & { ratingSum: number; perfSum: number }>();

  for (const [user, r] of entries) {
    const stats: UserStats = { white: r.white, draws: r.draws, black: r.black };
    if (r.queuePosition !== undefined) stats.queuePosition = r.queuePosition;
    perUser[user] = stats;
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
