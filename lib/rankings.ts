import bundled from "./formula-2027.json";
import { createServerClient } from "./supabase-server";

/**
 * The Top 25 as the site shows it: the formula's newest daily snapshot,
 * with any teams you placed by hand (top25_overrides) moved into their
 * spots. Server-only; it uses the secret key.
 */

export type Formula = typeof bundled;
type FormulaRow = Formula["rows"][number];

export type RankedRow = FormulaRow & {
  /** Where the formula alone put the team, before hand edits. */
  formula_rk: number | null;
  pinned: boolean;
  note: string | null;
  /** Pinned from outside the formula's output: no numbers to show. */
  stub: boolean;
};

export type Ranking = {
  formula: Formula;
  /** Ranked teams then honorable mentions, hand edits applied. */
  rows: RankedRow[];
};

export type Override = { school: string; rank: number; note: string | null; created_at?: string };

export async function getRanking(): Promise<Ranking> {
  const db = createServerClient();

  // Either table missing, or a failed read, falls back quietly: the
  // bundled file and no hand edits. The page should never go down over it.
  const [snap, pins] = await Promise.all([
    db
      .from("formula_snapshots")
      .select("data")
      .eq("season", bundled.season)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ data: Formula }>(),
    db
      .from("top25_overrides")
      .select("school, rank, note, created_at")
      .eq("is_active", true),
  ]);

  const formula = snap.data?.data ?? bundled;
  const overrides = (pins.data ?? []) as Override[];

  const known = new Set(formula.rows.map((r) => key(r.school)));
  const missing = overrides.filter((o) => o.rank > 0 && !known.has(key(o.school)));
  const stubs = missing.length ? await stubRows(db, missing.map((o) => o.school)) : new Map();

  return { formula, rows: applyOverrides(formula, overrides, stubs) };
}

const key = (s: string) => s.trim().toLowerCase();

/**
 * Hand picks moved into their spots, everyone else in formula order
 * around them. Overrides arrive newest first within each rank.
 */
export function applyOverrides(
  formula: Formula,
  overrides: Override[],
  stubs: Map<string, RankedRow> = new Map(),
): RankedRow[] {
  const slots = formula.params.RANKED + formula.params.HONORABLE;
  const bySchool = new Map(formula.rows.map((r) => [key(r.school), r]));

  // A school listed twice: the newest active row wins.
  const byNewest = [...overrides].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  const seen = new Set<string>();
  const latest = byNewest
    .filter((o) => !seen.has(key(o.school)) && seen.add(key(o.school)))
    .sort((a, b) => a.rank - b.rank);

  const removed = new Set(latest.filter((o) => o.rank === 0).map((o) => key(o.school)));
  const placed = latest.filter((o) => o.rank > 0 && o.rank <= slots);
  const placedKeys = new Set(placed.map((o) => key(o.school)));

  const asRow = (r: FormulaRow, pin?: Override): RankedRow => ({
    ...r,
    formula_rk: r.rk,
    pinned: !!pin,
    note: pin?.note ?? null,
    stub: false,
  });

  const out: (RankedRow | null)[] = new Array(slots).fill(null);
  for (const pin of placed) {
    const r = bySchool.get(key(pin.school));
    const stub = stubs.get(key(pin.school));
    if (!r && !stub) continue; // misspelled school: ignore rather than guess
    // Two picks for one spot: the newer keeps it, the older slides down.
    let i = pin.rank - 1;
    while (i < slots && out[i]) i++;
    if (i < slots) out[i] = r ? asRow(r, pin) : { ...stub!, note: pin.note };
  }

  const pool = formula.rows.filter(
    (r) => !placedKeys.has(key(r.school)) && !removed.has(key(r.school)),
  );
  for (let i = 0, p = 0; i < slots && p < pool.length; i++) {
    if (!out[i]) out[i] = asRow(pool[p++]);
  }

  return out
    .filter((r): r is RankedRow => r !== null)
    .map((r, i) => ({ ...r, rk: i + 1 }));
}

/** A pinned team the formula ranked below its output: name and link only. */
async function stubRows(db: ReturnType<typeof createServerClient>, schools: string[]) {
  // Matched loosely, like the pins themselves, so "uconn" still finds UConn.
  const wanted = new Set(schools.map((s) => s.trim().toLowerCase()));
  const { data } = await db.from("teams").select("id, school, conference").eq("is_d1", true);
  const out = new Map<string, RankedRow>();
  for (const t of data ?? []) {
    if (!wanted.has(t.school.trim().toLowerCase())) continue;
    out.set(t.school.trim().toLowerCase(), {
      ...(bundled.rows[0] as FormulaRow),
      team_id: t.id,
      school: t.school,
      conference: t.conference,
      identity: null,
      incomplete: false,
      transfers_in: [],
      formula_rk: null,
      pinned: true,
      note: null,
      stub: true,
    });
  }
  return out;
}
