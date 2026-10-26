import Link from "next/link";
import type { createServerClient } from "@/lib/supabase-server";
import {
  SOURCES,
  type CompositeRow,
  type SourceRank,
} from "@/lib/preseason";

/**
 * The 2026-27 composite table, shared by /rankings and the home page.
 * Team names link to last season's shot chart when the school is in
 * `teams`; `teamIds` maps school name to id.
 */
export function PreseasonTable({
  rows,
  teamIds,
}: {
  rows: CompositeRow[];
  teamIds: Map<string, number>;
}) {
  return (
    <div className="ratings-scroll">
      <table className="ratings">
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Team</th>
            <th scope="col" className="num is-sorted">Avg</th>
            {SOURCES.map((s) => (
              <th key={s.key} scope="col" className="num">
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.name.replace(/ \(.*\)$/, "")}
                </a>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const id = teamIds.get(r.school);
            return (
              <tr key={r.school}>
                <td className="num ratings-rk">{r.rk}</td>
                <td>
                  {id ? (
                    <Link href={`/shot-chart?team=${id}`}>{r.school}</Link>
                  ) : (
                    r.school
                  )}
                </td>
                <td className="num">{r.avg.toFixed(1)}</td>
                {SOURCES.map((s) => (
                  <td key={s.key} className="num ratings-src">
                    <SourceCell value={r.ranks[s.key]} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceCell({ value }: { value: SourceRank }) {
  if (value === null) {
    return (
      <span className="ratings-unknown" title="Not available from this source">
        –
      </span>
    );
  }
  if (value === "nr") {
    return (
      <span className="ratings-nr" title="Outside this source's published list">
        NR
      </span>
    );
  }
  return <>{value}</>;
}

/** How the composite is built, and what each source is. */
export function PreseasonMethod() {
  return (
    <section className="rank-method">
      <h2>How the composite works</h2>
      <p>
        No single preseason ranking is reliable on its own, and each one
        misses in its own way: the computer models lean on last season&rsquo;s
        numbers and recruiting rankings, and the expert ranking leans on
        opinion. Averaging them cancels out some of each one&rsquo;s blind
        spots.
      </p>
      <ol>
        <li>
          <strong>Collect the ranks.</strong> We take each source&rsquo;s
          published preseason rank for every team it lists. We use ranks
          only, not the sources&rsquo; underlying ratings, which are on
          different scales and in some cases behind a paywall.
        </li>
        <li>
          <strong>Fill gaps honestly.</strong> When a source publishes a
          complete list and a team isn&rsquo;t on it, the team counts as one
          spot below the end of the list. ESPN&rsquo;s top 25 is complete, so
          a team left off counts as 26th (shown as NR). When a source&rsquo;s
          public list is short or has gaps, missing teams are left out of
          that source entirely (shown as –) rather than guessed. Two of
          KenPom&rsquo;s top 25 spots couldn&rsquo;t be confirmed.
        </li>
        <li>
          <strong>Average.</strong> A team&rsquo;s composite score is the
          plain average of the ranks it has, with every source weighted
          equally. A team needs at least two to be ranked. Ties go to the
          team with more sources behind it.
        </li>
      </ol>
      <p>
        EvanMiya is left out on purpose. Only its top 10 is public, which
        is too few ranks to weigh it equally against full lists.
      </p>

      <h3>Sources</h3>
      <dl className="rank-sources">
        {SOURCES.map((s) => (
          <div key={s.key}>
            <dt>
              <a href={s.url} target="_blank" rel="noopener noreferrer">
                {s.name}
              </a>{" "}
              <span className="rank-asof">as of {formatDate(s.asOf)}</span>
            </dt>
            <dd>
              {s.kind}.{s.note ? ` ${s.note}` : ""}
            </dd>
          </div>
        ))}
      </dl>
      <p className="rank-note">
        All three are independent projects; the ranks belong to them and this
        site just averages them. Rankings move as rosters change, so check
        each source for its latest list.
      </p>
    </section>
  );
}

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** School name → teams.id, for linking composite rows to shot charts. */
export async function loadTeamIds(db: ReturnType<typeof createServerClient>) {
  const { data } = await db.from("teams").select("id, school").eq("is_d1", true);
  return new Map((data ?? []).map((t) => [t.school as string, t.id as number]));
}
