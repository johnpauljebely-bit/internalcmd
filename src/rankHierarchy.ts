// Ordered lowest to highest rank per department. "Sergeant+" in the brief is shorthand for
// "at or above the Sergeant tier" — NOT a literal numeric callsign threshold, since higher ranks
// have *lower* callsign numbers in this scheme (Commissioner 1050-1099 outranks Constable
// 1400-1499). Rank is looked up from our own callsigns table, not reverse-engineered from a
// numeric callsign band.
const RANK_HIERARCHY: Record<"rcmp" | "bchp", string[]> = {
  rcmp: ["constable", "corporal", "sergeant", "inspector", "superintendent", "commissioner"],
  bchp: ["constable", "corporal", "sergeant", "staff-sergeant", "inspector", "superintendent", "chief-superintendent"],
};

export function isSergeantOrAbove(department: "rcmp" | "bchp", rank: string): boolean {
  const order = RANK_HIERARCHY[department];
  const sergeantIndex = order.indexOf("sergeant");
  const rankIndex = order.indexOf(rank);
  if (rankIndex === -1) return false;
  return rankIndex >= sergeantIndex;
}
