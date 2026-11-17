# Going static — architecture and plan

The goal: no database query ever happens because someone visited the
site. Pages are HTML files on a CDN. Supabase is touched once a night,
by one script, and can sit idle the rest of the time.

That makes all three limits you've hit unreachable rather than merely
further away: no server functions means no Vercel/Netlify CPU, and no
request-time queries means no Supabase compute or disk IO from traffic.

---

## The thing that forces a redesign

**`searchParams` do not exist in a static export.** Your pages currently
work like this:

```
/shot-chart?player=201268&view=shots&side=defense
```

A static site is files on a CDN. There is no server to read
`?player=201268` and decide what to render. The file either exists at a
path or it doesn't.

So URLs become paths:

| now | after |
|---|---|
| `/shot-chart?player=201268` | `/player/201268` |
| `/shot-chart?team=2305` | `/team/2305` |
| `/shot-chart?team=2305&side=defense` | `/team/2305/defense` |
| `/rankings?tab=offense` | `/rankings/offense` |

This is better anyway — those URLs are shareable, linkable, and
indexable by Google, which the query-string versions never really were.

**The view toggle (zones vs. every shot) becomes client state**, not a
URL param. Both views live on the same page; a button switches between
them without navigating.

---

## Where the data lives

Two kinds, handled differently.

**Zone stats** — ten rows per player or team. Small. These get baked
directly into the HTML at build time. A page carrying ten rows of
numbers is a few kilobytes.

**Individual shot locations** — up to a few thousand points per player.
Too big to bake into every page; 5,000 pages × 4,000 points would be
hundreds of megabytes of HTML.

So those become **separate static JSON files**:

```
/data/shots/player-201268.json
/data/shots/team-2305.json
```

The page loads without them. When someone clicks "Every shot," the
browser fetches that one file from the CDN. Still zero server, still
instant, and the page stays light for the people who never click.

Coordinates get rounded to one decimal and stored as flat arrays rather
than objects — `[x, y, made]` triples — which cuts the file size by
roughly two thirds.

---

## Build pipeline

The build must **not** query Supabase 5,000 times. That's the current
problem wearing a different hat.

```
  nightly, in GitHub Actions
  ────────────────────────────────────────────────
  1. scripts/ingest-shots.ts       (unchanged)
  2. refresh matviews              (unchanged)
  3. scripts/export-data.ts   ←──  NEW
         ~12 bulk queries, writes data/*.json
  4. next build
         reads data/*.json, writes ~5,200 HTML files
  5. deploy
```

Step 3 is the important one. It pulls everything out of Postgres in a
dozen bulk queries and writes local JSON. Step 4 never touches the
network. That means:

- Supabase handles twelve queries a day instead of thousands
- The build works even if Supabase is paused, as long as the JSON exists
- You can rebuild the site locally without credentials

---

## Page count

| route | pages |
|---|---|
| `/` | 1 |
| `/player/[id]` | ~4,850 |
| `/team/[id]` and `/team/[id]/defense` | 730 |
| `/rankings`, `/rankings/offense`, `/rankings/defense` | 3 |
| **total** | **~5,600** |

Next generates those in roughly two to four minutes. Netlify's free tier
allows 300 build minutes a month, so a nightly build uses about 10% of
it.

---

## What gets lost

Worth being clear about the tradeoffs rather than finding them later.

**Live Wire is no longer live.** It updates when the site rebuilds —
nightly, or whenever you trigger a deploy. Posting breaking injury news
means triggering a build, which takes a few minutes. If you want it
genuinely instant, that one component can fetch client-side from
Supabase using the publishable key, which is safe to expose. That's one
small query per page view against a table with a dozen rows — nothing
like the load you have now. Decide this one deliberately.

**In-season shot updates lag by a day.** Already true, since the ingest
is nightly.

**Search in the picker** stays client-side, which it already is.

---

## Order of work

1. **Export script** (`scripts/export-data.ts`) — the foundation.
   Everything else reads its output.
2. **Route restructure** — `/player/[id]`, `/team/[id]`, `/rankings/*`.
   The biggest chunk.
3. **Client-side view toggle** — replaces the `?view=` param.
4. **`output: 'export'`** in `next.config.ts`, plus removing anything
   incompatible (`revalidate`, server-side `searchParams`).
5. **Workflow update** — add the export step before the build.
6. **Redirects** — old query-string URLs to the new paths, so anything
   already shared keeps working.

Steps 1 and 2 are most of the work. The rest is small.

---

## Before any of this

The site is suspended right now. Static hosting fixes the *future*, but
the build still needs one working connection to Supabase to export the
data.

So: either wait for the reset on November 27, or pay the $9 once, export
the data, and go static — at which point you can drop back down, because
a paused Supabase project is fine for a site that only reads it nightly.

Paying once to escape paying monthly is a reasonable trade.
