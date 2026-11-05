import Link from "next/link";

/** One player's line in one game, from player_game_stats. */
export type LogRow = {
  game_id: number;
  player_id: number;
  team_id: number;
  player_name: string | null;
  start_date: string | null;
  starter: boolean | null;
  minutes: number | null;
  points: number | null;
  oreb: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  fgm: number | null;
  fga: number | null;
  three_m: number | null;
  three_a: number | null;
  ftm: number | null;
  fta: number | null;
};

export type GameMeta = { id: number; date: string; opponent: string; home: boolean; result: string };

const n = (v: number | null | undefined) => v ?? 0;

/** "Nov 4", for a game the games table doesn't have (no shot data). */
function shortDate(iso: string | null) {
  return iso
    ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })
    : "";
}

function total(rows: LogRow[]) {
  const sum = (k: keyof LogRow) => rows.reduce((t, r) => t + n(r[k] as number | null), 0);
  return {
    minutes: sum("minutes"),
    points: sum("points"),
    oreb: sum("oreb"),
    rebounds: sum("rebounds"),
    assists: sum("assists"),
    steals: sum("steals"),
    blocks: sum("blocks"),
    turnovers: sum("turnovers"),
    fouls: sum("fouls"),
    fgm: sum("fgm"),
    fga: sum("fga"),
    three_m: sum("three_m"),
    three_a: sum("three_a"),
    ftm: sum("ftm"),
    fta: sum("fta"),
  };
}

type Line = ReturnType<typeof total>;

const COLS: [label: string, title: string, cell: (l: Line) => string][] = [
  ["PTS", "Points", (l) => String(l.points)],
  ["REB", "Rebounds", (l) => String(l.rebounds)],
  ["AST", "Assists", (l) => String(l.assists)],
  ["STL", "Steals", (l) => String(l.steals)],
  ["BLK", "Blocks", (l) => String(l.blocks)],
  ["TO", "Turnovers", (l) => String(l.turnovers)],
  ["FG", "Field goals made-attempted", (l) => `${l.fgm}-${l.fga}`],
  ["3PT", "Threes made-attempted", (l) => `${l.three_m}-${l.three_a}`],
  ["FT", "Free throws made-attempted", (l) => `${l.ftm}-${l.fta}`],
];

/**
 * The season game by game, newest first. A player's own lines, or a
 * team's players added up. Each date opens that game's shot chart.
 */
export function GameLog({
  rows,
  games,
  mode,
  base,
}: {
  rows: LogRow[];
  games: Map<number, GameMeta>;
  mode: "player" | "team";
  base: string;
}) {
  const byGame = new Map<number, LogRow[]>();
  for (const r of rows) byGame.set(r.game_id, [...(byGame.get(r.game_id) ?? []), r]);
  const order = [...byGame.keys()].sort((a, b) =>
    (byGame.get(b)![0].start_date ?? "").localeCompare(byGame.get(a)![0].start_date ?? ""),
  );
  if (!order.length) return null;

  return (
    <section className="game-log" aria-label="Game log">
      <h2>Game log</h2>
      <div className="game-log-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th>Result</th>
              {mode === "player" && <th title="Minutes">MIN</th>}
              {COLS.map(([label, title]) => (
                <th key={label} title={title}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((id) => {
              const lines = byGame.get(id)!;
              const meta = games.get(id);
              const line = total(lines);
              return (
                <tr key={id}>
                  <td>
                    <Link href={`${base}&game=${id}`} scroll={false} title="Open this game's shot chart">
                      {meta?.date ?? shortDate(lines[0].start_date)}
                    </Link>
                  </td>
                  <td className="game-log-opp">
                    {meta ? `${meta.home ? "vs" : "at"} ${meta.opponent}` : ""}
                  </td>
                  <td className={meta?.result.startsWith("W") ? "game-log-w" : "game-log-l"}>
                    {meta?.result ?? ""}
                  </td>
                  {mode === "player" && <td className="num">{line.minutes}</td>}
                  {COLS.map(([label, , cell]) => (
                    <td key={label} className="num">
                      {cell(line)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="accuracy-note">
        Official box scores, added each morning for the previous day&rsquo;s games. Pick a date to
        open that game&rsquo;s shot chart.
      </p>
    </section>
  );
}

/** One team's box score for one game: every player who played, then totals. */
export function BoxScore({ rows, title, season }: { rows: LogRow[]; title: string; season: number }) {
  if (!rows.length) return null;
  const players = [...rows].sort(
    (a, b) => Number(b.starter) - Number(a.starter) || n(b.minutes) - n(a.minutes),
  );
  const team = total(rows);
  return (
    <section className="game-log" aria-label={title}>
      <h2>{title}</h2>
      <div className="game-log-scroll">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th title="Minutes">MIN</th>
              {COLS.map(([label, t]) => (
                <th key={label} title={t}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.player_id}>
                <td>
                  <Link href={`/shot-chart?player=${p.player_id}&season=${season}`}>{p.player_name ?? "Unknown"}</Link>
                  {p.starter && <span className="game-log-starter" title="Starter">S</span>}
                </td>
                <td className="num">{n(p.minutes)}</td>
                {COLS.map(([label, , cell]) => (
                  <td key={label} className="num">
                    {cell(total([p]))}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="game-log-total">
              <td>Team</td>
              <td className="num">{team.minutes}</td>
              {COLS.map(([label, , cell]) => (
                <td key={label} className="num">
                  {cell(team)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
