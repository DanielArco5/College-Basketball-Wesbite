/** One row of team_season_totals, team_defense_season_totals or player_season_totals. */
export type SeasonTotals = {
  attempts: number;
  makes: number;
  three_attempts: number;
  three_makes: number;
  untracked_attempts: number;
  jumper_attempts: number;
  jumper_makes: number;
};

/** One row of d1_season_totals. */
export type LeagueTotals = Pick<
  SeasonTotals,
  "attempts" | "makes" | "three_attempts" | "three_makes"
>;

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");

/**
 * Shot mix and effective FG%, from season totals rather than the zone
 * rows, so shots from games without location tracking still count.
 * eFG% = (FGM + 0.5 × 3PM) / FGA, crediting a made three with the extra
 * point it's worth.
 */
export default function ShotMix({
  totals,
  league,
}: {
  totals: SeasonTotals;
  league: LeagueTotals | null;
}) {
  const {
    attempts,
    makes,
    three_attempts,
    three_makes,
    untracked_attempts,
    jumper_attempts,
    jumper_makes,
  } = totals;
  const twoAttempts = attempts - three_attempts;
  const twoMakes = makes - three_makes;

  // D1 comparisons: share of shots and FG% for 2s and 3s, and eFG%.
  const d1 = league && {
    twoShare: pct(league.attempts - league.three_attempts, league.attempts),
    twoPct: pct(league.makes - league.three_makes, league.attempts - league.three_attempts),
    threeShare: pct(league.three_attempts, league.attempts),
    threePct: pct(league.three_makes, league.three_attempts),
    efg: pct(league.makes + 0.5 * league.three_makes, league.attempts),
  };

  return (
    <>
      <section className="mix" aria-label="Shot mix and effective field goal percentage">
        <div className="mix-stat">
          <span className="mix-label">2-pointers</span>
          <span className="mix-value">{pct(twoAttempts, attempts)}</span>
          <span className="mix-detail">
            of shots · {twoMakes}/{twoAttempts} · {pct(twoMakes, twoAttempts)}
          </span>
          {d1 && (
            <span className="mix-avg">
              D1 avg {d1.twoShare} · {d1.twoPct}
            </span>
          )}
        </div>
        <div className="mix-stat">
          <span className="mix-label">3-pointers</span>
          <span className="mix-value">{pct(three_attempts, attempts)}</span>
          <span className="mix-detail">
            of shots · {three_makes}/{three_attempts} ·{" "}
            {pct(three_makes, three_attempts)}
          </span>
          {d1 && (
            <span className="mix-avg">
              D1 avg {d1.threeShare} · {d1.threePct}
            </span>
          )}
        </div>
        {/* By shot type, not location: a pull-up in the lane is a paint
            shot on the chart but still a jumper here. */}
        <div className="mix-stat">
          <span className="mix-label">2-pt jumpers</span>
          <span className="mix-value">{jumper_attempts.toLocaleString()}</span>
          <span className="mix-detail">
            {pct(jumper_attempts, twoAttempts)} of 2s · {jumper_makes}/{jumper_attempts} ·{" "}
            {pct(jumper_makes, jumper_attempts)}
          </span>
        </div>
        <div className="mix-stat">
          <span className="mix-label">eFG%</span>
          <span className="mix-value">{pct(makes + 0.5 * three_makes, attempts)}</span>
          <span className="mix-detail">Made threes count 1.5×</span>
          {d1 && <span className="mix-avg">D1 avg {d1.efg}</span>}
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
