import { type Zone } from "@/lib/court";
import { type ZoneStat } from "./ShotChart";

const THREES: Zone[] = [
  "corner_3_left",
  "corner_3_right",
  "wing_3_left",
  "top_3",
  "wing_3_right",
];

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "—");

/**
 * Shot mix and effective FG%, from the same raw zone makes/attempts as the
 * table. eFG% = (FGM + 0.5 × 3PM) / FGA, crediting a made three with the
 * extra point it's worth.
 */
export default function ShotMix({ stats }: { stats: ZoneStat[] }) {
  let twoMakes = 0;
  let twoAttempts = 0;
  let threeMakes = 0;
  let threeAttempts = 0;
  for (const s of stats) {
    if (THREES.includes(s.zone)) {
      threeMakes += s.makes;
      threeAttempts += s.attempts;
    } else {
      twoMakes += s.makes;
      twoAttempts += s.attempts;
    }
  }
  const attempts = twoAttempts + threeAttempts;
  const makes = twoMakes + threeMakes;

  return (
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
        <span className="mix-value">{pct(threeAttempts, attempts)}</span>
        <span className="mix-detail">
          of shots · {threeMakes}/{threeAttempts} ·{" "}
          {pct(threeMakes, threeAttempts)}
        </span>
      </div>
      <div className="mix-stat">
        <span className="mix-label">eFG%</span>
        <span className="mix-value">{pct(makes + 0.5 * threeMakes, attempts)}</span>
        <span className="mix-detail">Made threes count 1.5×</span>
      </div>
    </section>
  );
}
