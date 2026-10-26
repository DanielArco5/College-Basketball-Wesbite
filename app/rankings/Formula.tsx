import Link from "next/link";
import formula from "@/lib/formula-2027.json";

/**
 * Our 2026-27 preseason ranking, built by scripts/project-2027.ts. No
 * outside rankings go into it. The method text below describes that
 * script; keep the two in step.
 */

type FormulaRow = (typeof formula.rows)[number];

type InSeason = { source: string; fetched: string; max_games: number; blend_games: number };

const RANKED = formula.params.RANKED;
const W = formula.weights;

function pctOf(w: number) {
  return `${Math.round(w * 100)}%`;
}

function signed(n: number, places = 1) {
  return `${n > 0 ? "+" : ""}${n.toFixed(places)}`;
}

/** Value plus its D1 rank underneath, the way the shot chart shows vs D1. */
function Stat({ value, rank }: { value: string; rank: number }) {
  return (
    <>
      {value}
      <span className="ratings-sub">{rank}</span>
    </>
  );
}

export function FormulaRanking({ limit }: { limit?: number } = {}) {
  const top = formula.rows.slice(0, limit ?? RANKED);
  const honorable = limit ? [] : formula.rows.slice(RANKED);

  // null in the preseason file, so the JSON import can't infer its shape.
  const live = formula.in_season as InSeason | null;
  return (
    <>
      <p className="rank-stage">
        {live && formula.stage === "in-season" ? (
          <>
            Live: up to {live.max_games} games of 2026&ndash;27 results from
            NCAA.com, updated {live.fetched}. A team&rsquo;s real numbers count
            half once it has played {live.blend_games} games.
          </>
        ) : (
          <>
            Preseason projection. Real 2026&ndash;27 numbers start counting
            after tip-off on November 2.
          </>
        )}
      </p>
      <div className="ratings-scroll">
        <table className="ratings">
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Team</th>
              <th scope="col" className="num is-sorted" title="Weighted score; 0 is a typical D1 team">
                Score
              </th>
              <th scope="col" className="num" title="Points per 100 possessions">Off</th>
              <th
                scope="col"
                className="num"
                title={
                  formula.stage === "in-season"
                    ? "Offensive rebounds per missed shot"
                    : "Offensive rebound percentage"
                }
              >
                OREB%
              </th>
              <th scope="col" className="num" title="Turnovers forced minus committed, per 100 possessions">
                TO +/-
              </th>
              <th scope="col" className="num" title="Three-point percentage">3P%</th>
              <th scope="col" className="num" title="Points allowed per 100 possessions">Def</th>
              <th
                scope="col"
                className="num"
                title="Roster experience: last season's minutes back, plus half credit for minutes transfers played elsewhere in D1"
              >
                Exp
              </th>
              <th scope="col" className="ratings-conf">Key additions</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.team_id}>
                <td className="num ratings-rk">{r.rk}</td>
                <td>
                  <TeamLink row={r} />
                  <span className="ratings-team-conf">
                    {r.conference}
                    {r.identity && <IdentityBadge label={r.identity} />}
                  </span>
                </td>
                <td className="num">{signed(r.score, 2)}</td>
                <td className="num"><Stat value={r.off_eff.toFixed(1)} rank={r.ranks.offense} /></td>
                <td className="num"><Stat value={r.oreb_pct.toFixed(1)} rank={r.ranks.oreb} /></td>
                <td className="num"><Stat value={signed(r.to_margin)} rank={r.ranks.turnovers} /></td>
                <td className="num"><Stat value={r.three_pct.toFixed(1)} rank={r.ranks.three} /></td>
                <td className="num"><Stat value={r.def_eff.toFixed(1)} rank={r.ranks.defense} /></td>
                <td className="num"><Stat value={`${Math.round(r.experience * 100)}%`} rank={r.ranks.continuity} /></td>
                <td className="ratings-conf ratings-adds">
                  {r.transfers_in.map((t) => `${t.name} (${t.from})`).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {honorable.length > 0 && (
        <section className="rank-honorable">
          <h2>Honorable mentions</h2>
          <ol start={RANKED + 1}>
            {honorable.map((r) => (
              <li key={r.team_id}>
                <TeamLink row={r} /> <span className="rank-asof">{signed(r.score, 2)}</span>
                {r.identity && <IdentityBadge label={r.identity} />}
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="rank-note">
        Projected 2026-27 numbers. The small figure under each stat is that
        team&rsquo;s rank among all {formula.teams_rated} Division I teams.
        {formula.rows.some((r) => r.incomplete) && (
          <>
            {" "}
            <span className="rank-flag">*</span> Roster may be missing
            newcomers, so the projection leans on last season&rsquo;s team
            more than it should.
          </>
        )}
      </p>
    </>
  );
}

/** Why an outlier is here: it's elite at one thing. */
function IdentityBadge({ label }: { label: string }) {
  return (
    <span className={`rank-badge ${label === "Elite offense" ? "is-offense" : "is-margins"}`}>
      {label}
    </span>
  );
}

function TeamLink({ row }: { row: FormulaRow }) {
  return (
    <>
      <Link href={`/shot-chart?team=${row.team_id}`}>{row.school}</Link>
      {row.incomplete && (
        <span className="rank-flag" title="Roster may be missing newcomers">
          *
        </span>
      )}
    </>
  );
}

export function FormulaMethod() {
  const p = formula.params;
  const id = formula.identity;
  return (
    <section className="rank-method">
      <h2>How our formula works</h2>
      <p>
        No one else&rsquo;s rankings go into this, but it&rsquo;s built the
        same way the major ones are. {pctOf(W.net + W.competition)} of the
        score is a <strong>power rating</strong>: how many more points a team
        scores than it allows per possession, and the strength of the
        competition it does it against. The other{" "}
        {pctOf(1 - W.net - W.competition)} are <strong>style tilts</strong>{" "}
        toward efficient offense, offensive rebounding and an experienced
        roster. They move teams within the power rating&rsquo;s frame rather
        than overturn it. And there&rsquo;s room for outliers: a team truly
        elite at one thing can crack the Top 25 on that alone.
      </p>

      <table className="rank-weights">
        <thead>
          <tr>
            <th scope="col">Component</th>
            <th scope="col">What it measures</th>
            <th scope="col" className="num">Weight</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Net efficiency</td>
            <td>
              Points scored minus allowed per 100 possessions:{" "}
              {pctOf(1 - p.PRIOR_WEIGHT)} from the projected 2026-27 roster,{" "}
              {pctOf(p.PRIOR_WEIGHT)} from how the team actually played last
              season
            </td>
            <td className="num">{pctOf(W.net)}</td>
          </tr>
          <tr>
            <td>Competition</td>
            <td>Strength of the conference a team plays in</td>
            <td className="num">{pctOf(W.competition)}</td>
          </tr>
          <tr>
            <td>Offensive efficiency</td>
            <td>Points scored per 100 possessions</td>
            <td className="num">{pctOf(W.offense)}</td>
          </tr>
          <tr>
            <td>Offensive rebounding</td>
            <td>Share of its own misses a team gets back</td>
            <td className="num">{pctOf(W.oreb)}</td>
          </tr>
          <tr>
            <td>Roster experience</td>
            <td>
              Last season&rsquo;s minutes back with the same team, plus{" "}
              {pctOf(p.TRANSFER_CREDIT)} credit for minutes transfers played
              elsewhere in Division I
            </td>
            <td className="num">{pctOf(W.continuity)}</td>
          </tr>
          <tr>
            <td>Turnover margin</td>
            <td>Turnovers forced minus committed, per 100 possessions</td>
            <td className="num">{pctOf(W.turnovers)}</td>
          </tr>
          <tr>
            <td>Defensive efficiency</td>
            <td>Points allowed per 100 possessions</td>
            <td className="num">{pctOf(W.defense)}</td>
          </tr>
          <tr>
            <td>Three-point shooting</td>
            <td>Three-point percentage</td>
            <td className="num">{pctOf(W.three)}</td>
          </tr>
        </tbody>
      </table>

      <h3>Outliers: the identity bonus</h3>
      <p>
        Two kinds of team get lifted beyond their overall numbers, and
        they&rsquo;re marked in the table. <strong>Elite offense</strong> is a
        team whose projected scoring efficiency is far above the rest of
        Division I. <strong>Wins the margins</strong> is the methodical team
        that out-rebounds and out-possesses opponents: offensive rebounding
        and turnover margin together, far above the field. A team qualifies
        when it&rsquo;s more than {id.threshold} standard deviations above
        average at either, which is roughly the top 1% of the country, and
        each step past that adds to its score. Only its stronger identity
        counts.
      </p>

      <ol>
        <li>
          <strong>Start from last season&rsquo;s box scores.</strong> Every
          Division I team&rsquo;s 2025-26 totals: possessions, points,
          offensive and defensive rebounds, turnovers and three-pointers,
          for the team and its opponents.
        </li>
        <li>
          <strong>Adjust every stat for competition.</strong> Forcing 18
          turnovers a game against weak ball-handlers isn&rsquo;t the same as
          doing it against good ones. Each stat is corrected by how a
          team&rsquo;s opponents did in that stat against everyone else,
          recalculated until the numbers settle. Then competition counts a
          second time, as its own {pctOf(W.competition)} component: the
          average strength of the team&rsquo;s conference. That&rsquo;s what
          keeps a mid-major with gaudy numbers from outranking a power team
          that put up good ones against far better opponents.
        </li>
        <li>
          <strong>Follow the players to their 2026-27 teams.</strong> Every
          returning player and transfer brings his own offensive rating,
          offensive rebounding, turnovers and three-point shooting, weighted
          by how many minutes he played and corrected for the schedule his
          old team faced. Small samples are pulled toward average:{" "}
          {p.SHRINK_MINUTES} minutes of average play are blended into each
          player, and {p.SHRINK_THREES} average three-point attempts into
          each roster.
        </li>
        <li>
          <strong>Fill the unknown minutes with the program.</strong>{" "}
          Freshmen, international signings and players new to Division I
          have no college numbers. Their minutes are credited at{" "}
          {pctOf(p.PROGRAM_CARRYOVER)} of how far above average the program
          was last season. Good programs replace talent with talent.
        </li>
        <li>
          <strong>Carry defense by continuity.</strong> Box scores can&rsquo;t
          pin defense or forced turnovers on individual players, so a team
          keeps {pctOf(p.CONTINUITY_BASE)} of last season&rsquo;s edge in
          both, plus up to {pctOf(p.CONTINUITY_RETURN)} more depending on how
          many minutes return.
        </li>
        <li>
          <strong>Switch to real numbers as games are played.</strong> Once
          the season starts, each team&rsquo;s official 2026&ndash;27 totals
          from NCAA.com are put through the same formula and blended with the
          projection: after {p.BLEND_GAMES} games they count half, and more
          after that. NCAA.com doesn&rsquo;t publish schedules, so these
          in-season numbers are adjusted for the strength of a team&rsquo;s
          conference rather than its exact opponents.
        </li>
        <li>
          <strong>Score and rank.</strong> Each component becomes a standard
          score across all Division I teams (how many standard deviations
          above or below average), multiplied by its weight and added up. A
          score of 0 is a typical team. The top {RANKED} are ranked and the
          next {p.HONORABLE} are honorable mentions.
        </li>
      </ol>

      <h3>What it can&rsquo;t see</h3>
      <p>
        Freshmen, including five-stars, count only through their
        program&rsquo;s track record, so teams rebuilt around a top recruiting
        class can sit lower here than in the polls. Coaching changes aren&rsquo;t modeled.
        Players confirmed out for the season, such as UConn&rsquo;s Solo
        Ball and St. John&rsquo;s Donnie Freeman, are removed. Because the
        formula leans on hustle stats, a team that wins with size and
        half-court defense but doesn&rsquo;t force turnovers can rank a little
        lower here than in most polls. That&rsquo;s deliberate.
      </p>

      <h3>Where the numbers come from</h3>
      <p className="rank-note">
        The preseason projection uses 2025-26 team and player box-score
        totals and 2026-27 rosters from CollegeBasketballData, which compiles
        official box scores. In-season numbers come straight from{" "}
        <a href={formula.sources.in_season} target="_blank" rel="noopener noreferrer">
          NCAA.com&rsquo;s official team stats
        </a>
        ; checked against last season, they agree with the box scores on
        every stat used. We
        checked them against the conferences&rsquo; own published stats:
        turnover margins and three-point totals match the{" "}
        <a href={formula.sources.checks[0]} target="_blank" rel="noopener noreferrer">
          ACC
        </a>{" "}
        and{" "}
        <a href={formula.sources.checks[1]} target="_blank" rel="noopener noreferrer">
          Big East
        </a>{" "}
        figures. The roster source hasn&rsquo;t listed newcomers for many teams
        yet, so incoming transfers for the best-known teams were added from{" "}
        <a href={formula.sources.additions} target="_blank" rel="noopener noreferrer">
          ESPN&rsquo;s preseason breakdown
        </a>
        , using roster facts only. Last rebuilt{" "}
        {new Date(formula.generated_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
        .
      </p>
    </section>
  );
}
