import type { ErlcPlayer } from "./erlcClient.js";

export function matchPlayersByPartialUsername(query: string, players: ErlcPlayer[]): ErlcPlayer[] {
  const q = query.toLowerCase();
  return players.filter((p) => p.Player.split(":")[0].toLowerCase().includes(q));
}
