/**
 * A player's box-score season: per-game averages and the official
 * shooting splits, from player_box_seasons. A player who changed teams
 * mid-season has a row per team; they're added together here.
 */

export type BoxRow = {
  games: number | null;
  starts: number | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  oreb: number | null;
  dreb: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  fgm: number | null;
  fga: number | null;
  two_m: number | null;
  two_a: number | null;
  three_m: number | null;
  three_a: number | null;
  ftm: number | null;
  fta: number | null;
};

export default function PlayerStats({ rows, seasonLabel }: { rows: BoxRow[]; seasonLabel: string }) {
  if (!rows.length) return null;
  const sum = (k: keyof BoxRow) => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const games = sum("games");
  if (!games) return null;

  const perGame = (k: keyof BoxRow) => (sum(k) / games).toFixed(1);
  const pct = (made: number, att: number) => (att ? `${((100 * made) / att).toFixed(1)}%` : "—");
  const [fgm, fga, threeM] = [sum("fgm"), sum("fga"), sum("three_m")];
  const [ftm, fta, points] = [sum("ftm"), sum("fta"), sum("points")];
  // eFG% counts a three as 1.5 makes; TS% folds in free throws, each
  // trip worth 0.44 of a shot.
  const efg = fga ? (100 * (fgm + 0.5 * threeM)) / fga : null;
  const ts = fga + fta ? (100 * points) / (2 * (fga + 0.44 * fta)) : null;

  const counting: [string, keyof BoxRow][] = [
    ["PTS", "points"],
    ["REB", "rebounds"],
    ["AST", "assists"],
    ["STL", "steals"],
    ["BLK", "blocks"],
    ["TO", "turnovers"],
    ["PF", "fouls"],
  ];
  const splits: [string, number, number][] = [
    ["FG", fgm, fga],
    ["2PT", sum("two_m"), sum("two_a")],
    ["3PT", threeM, sum("three_a")],
    ["FT", ftm, fta],
  ];

  return (
    <section className="box" aria-label="Season stats">
      <p className="box-head">
        <strong>{seasonLabel} stats</strong> · {games} games
        {sum("starts") ? ` (${sum("starts")} starts)` : ""} · {perGame("minutes")} min per game
      </p>
      <div className="box-grid">
        {counting.map(([label, key]) => (
          <div key={label} className="box-stat">
            <span className="box-label">{label}</span>
            <span className="box-value">{perGame(key)}</span>
            <span className="box-sub">{sum(key)} total</span>
          </div>
        ))}
      </div>
      <div className="box-grid box-splits">
        {splits.map(([label, made, att]) => (
          <div key={label} className="box-stat">
            <span className="box-label">{label}</span>
            <span className="box-value">{pct(made, att)}</span>
            <span className="box-sub">
              {made}/{att}
            </span>
          </div>
        ))}
        <div className="box-stat">
          <span className="box-label">eFG%</span>
          <span className="box-value">{efg === null ? "—" : `${efg.toFixed(1)}%`}</span>
          <span className="box-sub">threes count 1.5×</span>
        </div>
        <div className="box-stat">
          <span className="box-label">TS%</span>
          <span className="box-value">{ts === null ? "—" : `${ts.toFixed(1)}%`}</span>
          <span className="box-sub">with free throws</span>
        </div>
      </div>
    </section>
  );
}
