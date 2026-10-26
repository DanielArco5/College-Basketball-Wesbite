import { createServerClient } from "@/lib/supabase-server";
import LiveWire, { type WireEntry } from "./LiveWire";
import SiteNav from "./SiteNav";
import "./site-chrome.css";

/**
 * The ticker and nav that sit above every page.
 *
 * This lives in the root layout rather than on individual pages so the
 * shot chart, the rankings and the home page read as one site instead of
 * a set of separate tools that happen to share a palette.
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
      <LiveWire entries={(data ?? []) as WireEntry[]} />
      <SiteNav />
    </>
  );
}
