import { getWire } from "@/lib/wire";
import LiveWire from "./LiveWire";
import SiteNav from "./SiteNav";
import "./site-chrome.css";

/**
 * Runs before first paint, so a viewer who switched the ticker off never
 * sees it flash in and disappear. Reading localStorage inside React
 * would be a frame too late — the markup is already on screen by then.
 */
const WIRE_PREF = `
try {
  var v = localStorage.getItem('cbb.wire');
  document.documentElement.dataset.wire = v === 'off' ? 'off' : 'on';
} catch (e) {
  document.documentElement.dataset.wire = 'on';
}
`;

/**
 * The ticker and nav above every page. Living in the root layout is what
 * makes the shot charts, the ratings and the home page read as one site
 * rather than three tools sharing a palette.
 */
export default async function SiteChrome() {
  // Scores, top scorers and injuries first, then the rest of the news.
  // Every part fails soft: a missing source just leaves its items out.
  const entries = await getWire();

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: WIRE_PREF }} />
      <LiveWire entries={entries} />
      <SiteNav />
    </>
  );
}
