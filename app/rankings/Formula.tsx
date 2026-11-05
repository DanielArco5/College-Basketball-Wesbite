import Link from "next/link";
import type { Formula, RankedRow, Ranking } from "@/lib/rankings";
import { IdentityBadge, signed, Stat } from "./bits";

/**
 * Our 2026-27 ranking, built daily by scripts/project-2027.ts, with hand
 * picks from top25_overrides applied by lib/rankings.ts. The method text
 * below describes that script; keep the two in step.
 */

// final_games is missing from snapshots made before results moved the score.
type InSeason = { source: string; fetched: string; results_fetched?: string; final_games?: number; max_games: number };

function pctOf(w: number) {
  return `${Math.round(w * 100)}%`;
}



export function FormulaRanking({ ranking, limit }: { ranking: Ranking; limit?: number }) {
  const { formula } = ranking;
  const RANKED = formula.params.RANKED;
  const top = ranking.rows.slice(0, limit ?? RANKED);
  const honorable = limit ? [] : ranking.rows.slice(RANKED);

  // null in the preseason file, so the JSON import can't infer its shape.
  const live = formula.in_season as InSeason | null;
  return (
    <>
      <p className="rank-stage">
        {live && formula.stage === "in-season" ? (
          <>
            Live: {(live.final_games ?? 0).toLocaleString()} games played so far, up to{" "}
            {live.max_games} per team. Only finished games count, and each one moves a team
            about a tenth of the way toward how it played. Re-ranked every hour on game days.
          </>
        ) : (
          <>
            Preseason projection. Real 2026&ndash;27 numbers start counting
            after tip-off on November 2.
          </>
        )}
      </p>

      {!limit && <Movers rows={ranking.rows.slice(0, 50)} />}

      <div className="ratings-scroll">
        <table className="ratings rank-top">
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Team</th>
              <th
                scope="col"
                className="num is-sorted"
                title="Points per 100 possessions better than an average D1 team, on a neutral floor"
              >
                Rating
              </th>
              <th scope="col" title="Rank over the season">Trend</th>
              <th scope="col">Last game</th>
              <th scope="col">Next</th>
              <th scope="col" className="num" title="Points per 100 possessions">Off</th>
              <th scope="col" className="num" title="Points allowed per 100 possessions">Def</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.team_id} style={teamColor(r.color)}>
                <td className="num ratings-rk">
                  <span className="rank-rk">{r.rk}</span>
                  {!r.stub && <Move now={r.rk} before={r.prev_rk} />}
                </td>
                <td className="rank-team">
                  <TeamLink row={r} />
                  <span className="ratings-team-conf">
                    {!r.stub && r.games > 0 && r.wins !== undefined && `${r.wins}-${r.losses} · `}
                    {r.conference}
                    {r.identity && <IdentityBadge label={r.identity} />}
                    {r.pinned && <PickBadge row={r} />}
                    {r.adjustment && <AdjustBadge adjustment={r.adjustment} />}
                  </span>
                  {r.transfers_in.length > 0 && (
                    <span className="ratings-adds-line">
                      Adds {r.transfers_in.map((t) => `${t.name} (${t.from})`).join(", ")}
                    </span>
                  )}
                </td>
                {r.stub ? (
                  // Pinned from outside the formula's ratings: nothing to show.
                  <td className="num ratings-src" colSpan={6}>
                    Not rated by the formula
                  </td>
                ) : (
                  <>
                    <td className="num rank-rating">{signed(r.rating ?? 0, 1)}</td>
                    <td>
                      <Trend ranks={r.trend ?? []} />
                    </td>
                    <td className="rank-game">
                      <LastGame game={r.last_game} />
                    </td>
                    <td className="rank-game">
                      <NextGame game={r.next_game} />
                    </td>
                    <td className="num"><Stat value={r.off_eff.toFixed(1)} rank={r.ranks.offense} /></td>
                    <td className="num"><Stat value={r.def_eff.toFixed(1)} rank={r.ranks.defense} /></td>
                  </>
                )}
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
                <TeamLink row={r} />{" "}
                {!r.stub && <span className="rank-asof">{signed(r.rating ?? 0, 1)}</span>}
                {!r.stub && <Move now={r.rk} before={r.prev_rk} />}
                {r.identity && <IdentityBadge label={r.identity} />}
                {r.pinned && <PickBadge row={r} />}
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="rank-note">
        Rating is how many points per 100 possessions better than an average Division I team
        a team is, on a neutral floor: +20 would beat an average team by about 14 in a
        70-possession game. Arrows show the change since yesterday. Off and Def are
        2026&ndash;27 numbers once a team has played, with its national rank underneath.
        {ranking.rows.some((r) => r.incomplete) && (
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

type Game = { date: string; opponent: string; site: string; won?: boolean; score?: string } | null;

const where = (site: string) => (site === "home" ? "vs" : site === "away" ? "at" : "vs");
const dayOf = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", ...opts });

function LastGame({ game }: { game: Game }) {
  if (!game) return <span className="rank-dim">&ndash;</span>;
  return (
    <>
      <span className={game.won ? "rank-w" : "rank-l"}>
        {game.won ? "W" : "L"} {game.score}
      </span>{" "}
      {where(game.site)} {game.opponent}
      {game.site === "neutral" && <span className="rank-dim"> (N)</span>}
      <span className="rank-sub">{dayOf(game.date, { month: "short", day: "numeric" })}</span>
    </>
  );
}

function NextGame({ game }: { game: Game }) {
  if (!game) return <span className="rank-dim">&ndash;</span>;
  return (
    <>
      {where(game.site)} {game.opponent}
      {game.site === "neutral" && <span className="rank-dim"> (N)</span>}
      <span className="rank-sub">
        {dayOf(game.date, { weekday: "short", month: "short", day: "numeric" })}
      </span>
    </>
  );
}

/** Up or down since yesterday's ranking. */
function Move({ now, before }: { now: number; before: number | null | undefined }) {
  if (!before) return <span className="rank-move is-new" title="New since yesterday">new</span>;
  const d = before - now;
  if (!d) return <span className="rank-move is-flat" title="No change since yesterday">&ndash;</span>;
  return (
    <span className={`rank-move ${d > 0 ? "is-up" : "is-down"}`} title={`Was No. ${before} yesterday`}>
      {d > 0 ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}

/** Rank day by day, No. 1 at the top. One day is just a dot. */
function Trend({ ranks }: { ranks: number[] }) {
  if (!ranks.length) return null;
  const W = 76;
  const H = 24;
  const worst = Math.max(30, ...ranks);
  const x = (i: number) => (ranks.length === 1 ? W - 3 : 3 + (i * (W - 6)) / (ranks.length - 1));
  const y = (rk: number) => 3 + ((rk - 1) / (worst - 1)) * (H - 6);
  const points = ranks.map((rk, i) => `${x(i).toFixed(1)},${y(rk).toFixed(1)}`).join(" ");
  const first = ranks[0];
  const last = ranks.at(-1)!;
  return (
    <svg
      className="rank-trend"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        ranks.length > 1 ? `From No. ${first} to No. ${last} over ${ranks.length} days` : `No. ${last}`
      }
    >
      <line x1={0} x2={W} y1={y(25)} y2={y(25)} className="rank-trend-cut" />
      {ranks.length > 1 && <polyline points={points} />}
      <circle cx={x(ranks.length - 1)} cy={y(last)} r={2.5} />
    </svg>
  );
}

/** Biggest risers and fallers among the top 50 since yesterday. */
function Movers({ rows }: { rows: RankedRow[] }) {
  const moved = rows
    .filter((r) => !r.stub && r.prev_rk)
    .map((r) => ({ r, d: r.prev_rk! - r.rk }))
    .filter((m) => m.d !== 0);
  if (!moved.length) return null;
  const up = [...moved].sort((a, b) => b.d - a.d).filter((m) => m.d > 0).slice(0, 3);
  const down = [...moved].sort((a, b) => a.d - b.d).filter((m) => m.d < 0).slice(0, 3);
  const item = ({ r, d }: { r: RankedRow; d: number }) => (
    <li key={r.team_id} style={teamColor(r.color)}>
      <Link href={`/shot-chart?team=${r.team_id}`}>{r.school}</Link>
      <span className={`rank-move ${d > 0 ? "is-up" : "is-down"}`}>
        {d > 0 ? "▲" : "▼"}
        {Math.abs(d)}
      </span>
      <span className="rank-sub">
        No. {r.prev_rk} &rarr; {r.rk}
        {r.last_game && ` · ${r.last_game.won ? "W" : "L"} ${r.last_game.score} ${where(r.last_game.site)} ${r.last_game.opponent}`}
      </span>
    </li>
  );
  return (
    <section className="rank-movers" aria-label="Biggest movers since yesterday">
      {up.length > 0 && (
        <div>
          <h2>Rising</h2>
          <ul>{up.map(item)}</ul>
        </div>
      )}
      {down.length > 0 && (
        <div>
          <h2>Falling</h2>
          <ul>{down.map(item)}</ul>
        </div>
      )}
    </section>
  );
}

/** The team's color as a CSS variable, for its row stripe. */
function teamColor(color: string | null | undefined) {
  return color ? ({ ["--team" as string]: color } as React.CSSProperties) : undefined;
}

/** Our call on the preseason rating; the reason is in the tooltip. */
function AdjustBadge({ adjustment }: { adjustment: { points: number; why: string } }) {
  return (
    <span className="rank-badge is-adjust" title={`${adjustment.why}. ${signed(adjustment.points, 1)} rating points.`}>
      Our call {signed(adjustment.points, 1)}
    </span>
  );
}

/** Placed by hand. The formula's own spot stays visible next to it. */
function PickBadge({ row }: { row: RankedRow }) {
  return (
    <span className="rank-badge is-pick" title={row.note ?? "Placed by hand"}>
      Our pick{row.formula_rk ? ` · formula #${row.formula_rk}` : ""}
    </span>
  );
}

function TeamLink({ row }: { row: RankedRow }) {
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

export function FormulaMethod({ formula }: { formula: Formula }) {
  const RANKED = formula.params.RANKED;
  const X = formula.external;
  const W = formula.weights;
  const p = formula.params;
  const id = formula.identity;
  return (
    <section className="rank-method">
      <h2>How our formula works</h2>
      <p>
        Two halves. {pctOf(1 - X.weight)} is <strong>our own formula</strong>,
        described below. {pctOf(X.weight)} is the{" "}
        <strong>consensus of the established preseason rankings</strong>:{" "}
        {X.sources.map((s, i) => (
          <span key={s.name}>
            {i > 0 && (i === X.sources.length - 1 ? " and " : ", ")}
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              {s.name}
            </a>
          </span>
        ))}
        . A team ranked k-th by the consensus gets the score our k-th best team
        has, so both halves sit on one scale.
      </p>
      <p>
        Our formula uses only box-score data, and it&rsquo;s built the same
        way the major ones are.{" "}
        {pctOf(W.net + W.competition + W.winning)} of the score is a{" "}
        <strong>power rating</strong>: how many more points a team scores
        than it allows per possession, the strength of the competition it
        does it against, and whether it actually won. The other{" "}
        {pctOf(1 - W.net - W.competition - W.winning)} are{" "}
        <strong>style tilts</strong> toward defense, efficient offense,
        offensive rebounding and an experienced roster. They move teams within the power rating&rsquo;s frame rather
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
            <td>Winning</td>
            <td>Last season&rsquo;s win percentage. Programs that win tend to keep winning</td>
            <td className="num">{pctOf(W.winning)}</td>
          </tr>
          <tr>
            <td>Defensive efficiency</td>
            <td>Points allowed per 100 possessions</td>
            <td className="num">{pctOf(W.defense)}</td>
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
            <td>Three-point shooting</td>
            <td>Three-point percentage</td>
            <td className="num">{pctOf(W.three)}</td>
          </tr>
          <tr>
            <td>Recruiting</td>
            <td>
              The incoming freshman class, by national ranking: a top-5
              recruit counts most, a top-100 one a little, capped at{" "}
              {p.RECRUIT_CAP} so one class can&rsquo;t outweigh a roster
            </td>
            <td className="num">{pctOf(W.recruits)}</td>
          </tr>
        </tbody>
      </table>

      <h3>Outliers: the identity bonus</h3>
      <p>
        Three kinds of team get lifted beyond their overall numbers, and
        they&rsquo;re marked in the table. <strong>Elite offense</strong> and{" "}
        <strong>Elite defense</strong> are teams whose projected scoring, or
        stopping, is far above the rest of Division I.{" "}
        <strong>Wins the margins</strong> is the methodical team
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
          <strong>Carry defense with the program.</strong> Box scores
          can&rsquo;t pin defense or forced turnovers on individual players,
          and defense is the most coach-driven part of the game. So a team
          keeps {pctOf(p.CONTINUITY_BASE)} of last season&rsquo;s defensive
          edge for its coach and system, plus up to{" "}
          {pctOf(p.CONTINUITY_RETURN)} more depending on how many minutes
          return.
        </li>
        <li>
          <strong>Score the preseason.</strong> Each component becomes a
          standard score across all Division I teams (how many standard
          deviations above or below average), multiplied by its weight and
          added up, then blended with the outside rankings above. That gives
          every team a preseason rating, put in the same units as the
          in-season one: points per 100 possessions better than an average
          team.
        </li>
        <li>
          <strong>Then play the games, slowly.</strong> Once the season
          starts, the box score of every finished game is a piece of
          evidence. A team&rsquo;s scoring margin per 100 possessions is
          credited for who it came against and where (a true home game is
          worth {p.EM_HOME_EDGE}), the way KenPom and Torvik build their
          ratings: beating a weak team by what a strong team should earns
          nothing, and doing it to a strong team earns a lot. Blowouts count
          no bigger than {p.EM_GAME_CAP} points per 100 possessions. The
          preseason rating counts as {p.PRIOR_GAMES} games of evidence, so a
          single game moves a team about a tenth of the way toward how it
          played, and by midseason the games have taken over. That is{" "}
          {pctOf(p.POWER_SHARE)} of the score.
        </li>
        <li>
          <strong>And a little for winning.</strong> The other{" "}
          {pctOf(1 - p.POWER_SHARE)} is results: each final is compared with
          what the ratings expected, a win worth {p.WIN_BONUS} points more
          than a loss by the same margin. Winning never costs a team and
          losing never helps one. Games still in progress don&rsquo;t count.
        </li>
        <li>
          <strong>Rank.</strong> The top {RANKED} are ranked and the next{" "}
          {p.HONORABLE} are honorable mentions. All of this reruns every hour
          on game days, as box scores and final scores come in.
        </li>
        <li>
          <strong>Our calls.</strong> Where we know something the numbers
          don&rsquo;t weigh enough, like a team that lost its top scorers, we
          move its preseason rating by a few points and tag it &ldquo;Our
          call&rdquo; with the reason. It fades with the rest of the
          preseason as games are played, so the results still decide.
        </li>
        <li>
          <strong>Our picks.</strong> We can place a team by hand when we
          see something the numbers don&rsquo;t. Those teams are tagged
          &ldquo;Our pick&rdquo; with the spot the formula alone gave them,
          and everyone else keeps the formula&rsquo;s order around them.
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
