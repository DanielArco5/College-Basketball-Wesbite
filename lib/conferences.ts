import conferences2027 from "./conferences-2027.json";

/**
 * Conference by season. The teams table holds the 2025-26 alignment;
 * 2026-27, after realignment (Gonzaga, Boise State, San Diego State and
 * others to the Pac-12, and so on), comes from the CBBD rosters via
 * lib/conferences-2027.json, which scripts/project-2027.ts writes.
 *
 * Seasons are named by the year they end: 2027 is 2026-27.
 */

type Alignment = Record<string, { school: string; conference: string | null }>;

const BY_SEASON: Record<number, Alignment> = {
  2027: conferences2027 as Alignment,
};

/** A team's conference in `season`. `current` is the teams-table value,
 *  used for any season without its own alignment file (2025-26). */
export function conferenceOf(teamId: number, season: number, current: string | null) {
  const alignment = BY_SEASON[season];
  if (!alignment) return current;
  return alignment[teamId] ? alignment[teamId].conference : current;
}

/** Every program in `conference` in `season`, by school name. `teams` is
 *  the D1 teams table; programs new to D1 with no row yet are included by
 *  name, with no id. */
export function membersOf(
  conference: string,
  season: number,
  teams: { id: number; school: string; conference: string | null }[],
): { id: number | null; school: string }[] {
  const known = new Set(teams.map((t) => t.id));
  const members: { id: number | null; school: string }[] = teams
    .filter((t) => conferenceOf(t.id, season, t.conference) === conference)
    .map((t) => ({ id: t.id, school: t.school }));
  for (const [id, t] of Object.entries(BY_SEASON[season] ?? {})) {
    if (!known.has(Number(id)) && t.conference === conference) {
      members.push({ id: null, school: t.school });
    }
  }
  return members.sort((a, b) => a.school.localeCompare(b.school));
}
