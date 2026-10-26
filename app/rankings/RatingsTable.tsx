import Link from "next/link";
import { pps, type RatingSort, type TeamRating } from "@/lib/ratings";

/**
 * The ratings table, shared by /rankings and the home page's Top 25 tab.
 * The rank column follows the active sort, so on the Defense view "1"
 * means the best defense, not the best team.
 */
export default function RatingsTable({
  rows,
  sort = "net",
}: {
  rows: TeamRating[];
  sort?: RatingSort;
}) {
  const rankOf = (r: TeamRating) =>
    sort === "off" ? r.off_rk : sort === "def" ? r.def_rk : r.rk;

  return (
    <div className="ratings-scroll">
      <table className="ratings">
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Team</th>
            <th scope="col" className="ratings-conf">Conf</th>
            <th scope="col" className={`num${sort === "off" ? " is-sorted" : ""}`}>
              Off
            </th>
            <th scope="col" className={`num${sort === "def" ? " is-sorted" : ""}`}>
              Def
            </th>
            <th scope="col" className={`num${sort === "net" ? " is-sorted" : ""}`}>
              Net
            </th>
            <th scope="col" className="num ratings-overall">Overall</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team_id}>
              <td className="num ratings-rk">{rankOf(r)}</td>
              <td>
                <Link href={`/shot-chart?team=${r.team_id}`}>{r.school}</Link>
              </td>
              <td className="ratings-conf">{r.conference ?? ""}</td>
              <td className="num">
                {pps(r.adj_off)}
                <span className="ratings-sub">{r.off_rk}</span>
              </td>
              <td className="num">
                {pps(r.adj_def)}
                <span className="ratings-sub">{r.def_rk}</span>
              </td>
              <td className="num">
                {r.net > 0 ? "+" : ""}
                {pps(r.net)}
              </td>
              <td className="num ratings-overall">{r.rk}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What these numbers are and aren't. Shown wherever the ratings appear. */
export function RatingsCaveat() {
  return (
    <p className="rank-note">
      This is a shooting rating, not a power rating. It counts only field
      goal attempts: turnovers, offensive rebounds and free throws aren&rsquo;t
      in the data, so it isn&rsquo;t points per possession, and a team that
      shoots well but turns it over a lot will look better here than it is.
      It describes last season and doesn&rsquo;t predict this one. The small
      number beside each figure is that side&rsquo;s rank.
    </p>
  );
}
