/** One row of team_season_totals, team_defense_season_totals or player_season_totals. */
export type SeasonTotals = {
  attempts: number;
  makes: number;
  three_attempts: number;
  three_makes: number;
  untracked_attempts: number;
};

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");

/**
 * Shot mix and effective FG%, from season totals rather than the zone
 * rows, so shots from games without location tracking still count.
 * eFG% = (FGM + 0.5 × 3PM) / FGA, crediting a made three with the extra
 * point it's worth.
 */
export default function ShotMix({ totals }: { totals: SeasonTotals }) {
  const { attempts, makes, three_attempts, three_makes, untracked_attempts } = totals;
  const twoAttempts = attempts - three_attempts;
  const twoMakes = makes - three_makes;

  return (
    <>
      <section className="mix" aria-label="Shot mix and effective field goal percentage">
        <div className="mix-stat">
          <span className="mix-label">2-pointers</span>
          <span className="mix-value">{pct(twoAttempts, attempts)}</span>
          <span className="mix-detail">
            of shots · {twoMakes}/{twoAttempts} · {pct(twoMakes, twoAttempts)}
          </span>
        </div>
        <div className="mix-stat">
          <span className="mix-label">3-pointers</span>
          <span className="mix-value">{pct(three_attempts, attempts)}</span>
          <span className="mix-detail">
            of shots · {three_makes}/{three_attempts} ·{" "}
            {pct(three_makes, three_attempts)}
          </span>
        </div>
        <div className="mix-stat">
          <span className="mix-label">eFG%</span>
          <span className="mix-value">{pct(makes + 0.5 * three_makes, attempts)}</span>
          <span className="mix-detail">Made threes count 1.5×</span>
        </div>
      </section>
      {untracked_attempts > 0 && (
        <p className="mix-note">
          Totals include {untracked_attempts.toLocaleString()} shots with no
          recorded court location, mostly from games without shot tracking.
          They count here but can’t be placed on the chart.
        </p>
      )}
    </>
  );
}
