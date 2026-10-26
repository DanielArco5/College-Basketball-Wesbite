import Link from "next/link";
import formula from "@/lib/formula-2027.json";

/**
 * Our own 2026-27 preseason ranking, built by scripts/project-2027.ts
 * from this site's 2025-26 data and 2026-27 rosters. No outside rankings
 * go into it. The method text below describes that script; keep the two
 * in step.
 */

type FormulaRow = (typeof formula.rows)[number];

const RANKED = formula.params.RANKED;

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${n.toFixed(3)}`;
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function FormulaRanking() {
  const top = formula.rows.slice(0, RANKED);
  const honorable = formula.rows.slice(RANKED);

  return (
    <>
      <div className="ratings-scroll">
        <table className="ratings">
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Team</th>
              <th scope="col" className="num is-sorted">Net</th>
              <th scope="col" className="num">Off</th>
              <th scope="col" className="num">Def</th>
              <th scope="col" className="num">Back</th>
              <th scope="col" className="ratings-conf">Key additions</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.team_id}>
                <td className="num ratings-rk">{r.rk}</td>
                <td>
                  <TeamLink row={r} />
                </td>
                <td className="num">{signed(r.net)}</td>
                <td className="num">{r.off.toFixed(3)}</td>
                <td className="num">{r.def.toFixed(3)}</td>
                <td className="num">{pct(r.returning)}</td>
                <td className="ratings-conf ratings-adds">
                  {r.transfers_in.map((t) => `${t.name} (${t.from})`).join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rank-honorable">
        <h2>Honorable mentions</h2>
        <ol start={RANKED + 1}>
          {honorable.map((r) => (
            <li key={r.team_id}>
              <TeamLink row={r} /> <span className="rank-asof">{signed(r.net)}</span>
            </li>
          ))}
        </ol>
      </section>

      {formula.rows.some((r) => r.incomplete) && (
        <p className="rank-note">
          <span className="rank-flag">*</span> Roster may be missing
          newcomers. Our roster source hasn&rsquo;t added this team&rsquo;s
          incoming players yet, so its projection leans on last season&rsquo;s
          program strength more than it should.
        </p>
      )}
    </>
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
  return (
    <section className="rank-method">
      <h2>How our formula works</h2>
      <p>
        This ranking uses no one else&rsquo;s rankings. It starts from what
        each player actually did last season, follows them to where they
        play now, and adds it up. Every input is data this site already
        shows: 2025-26 shot results and our schedule-adjusted team ratings,
        plus 2026-27 rosters.
      </p>
      <ol>
        <li>
          <strong>Value every returning player and transfer.</strong> Each
          player&rsquo;s points per shot from 2025-26 is blended with{" "}
          {p.SHRINK_ATTEMPTS} attempts of Division I average shooting, so a
          hot streak on a few shots doesn&rsquo;t count as talent. It&rsquo;s
          then credited for the schedule his old team played. A transfer
          from a low-major gets a smaller boost than one from the Big Ten.
        </li>
        <li>
          <strong>Weight by role.</strong> A player counts in proportion to
          the share of his new team&rsquo;s shots he took last season. If a
          roster has more proven shooters than one team can feed, everyone
          is scaled down to a full team&rsquo;s worth.
        </li>
        <li>
          <strong>Fill the rest with the program.</strong> Freshmen,
          international signings and players new to Division I have no
          college shots to measure. Their share of the offense is credited
          at {Math.round(p.PROGRAM_CARRYOVER * 100)}% of how far above
          average the program was last season. Strong programs tend to
          replace talent with talent, but not one-for-one.
        </li>
        <li>
          <strong>Project the defense from continuity.</strong> The data
          can&rsquo;t pin defense on individual players, so a team keeps{" "}
          {Math.round(p.DEF_BASE * 100)}% of last season&rsquo;s defensive edge
          for its coach and system, plus up to{" "}
          {Math.round(p.DEF_CONTINUITY * 100)}% more in proportion to how much
          of its roster returns.
        </li>
        <li>
          <strong>Rank by net.</strong> Projected points per shot scored minus
          allowed. The top {RANKED} are ranked and the next{" "}
          {p.HONORABLE} are honorable mentions.
        </li>
      </ol>

      <h3>What it can&rsquo;t see</h3>
      <p>
        Freshmen, including five-stars, count only through their
        program&rsquo;s track record. Coaching changes aren&rsquo;t modeled.
        Turnovers, rebounding and free throws aren&rsquo;t in the data, so
        this is a shooting projection, not a full one. Players confirmed out
        for the season, such as UConn&rsquo;s Solo Ball and St. John&rsquo;s
        Donnie Freeman, are removed.
      </p>
      <p className="rank-note">
        Rosters from CollegeBasketballData. Their 2026-27 rosters don&rsquo;t
        yet list newcomers for many teams, so incoming transfers for ranked
        teams were added from{" "}
        <a href={formula.sources.additions} target="_blank" rel="noopener noreferrer">
          ESPN&rsquo;s preseason poll breakdown
        </a>
        , using rosters only and not rankings. Last rebuilt{" "}
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
