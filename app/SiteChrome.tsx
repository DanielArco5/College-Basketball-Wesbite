import { createServerClient } from "@/lib/supabase-server";
import LiveWire, { type WireEntry } from "./LiveWire";
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
  const db = createServerClient();

  // A failure here must not take down every page on the site, so the
  // error is swallowed and the ticker simply doesn't render. This is the
  // one query in the app where silence is the right behaviour.
  const { data } = await db
    .from("live_wire_entries")
    .select("id, kind, headline, url, published_at")
    .eq("is_live", true)
    .order("published_at", { ascending: false })
    .limit(12);

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: WIRE_PREF }} />
      <LiveWire entries={(data ?? []) as WireEntry[]} />
      <SiteNav />
    </>
  );
}
