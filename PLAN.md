# Finishing plan — CBB Website

Written 2026-10-25, merged with TODO.md and updated the same night. Work
through what's left top to bottom; each step says how you know it worked.
Where a step can't be verified from a query result, it says to look at
the page, because several bugs in this project have looked completely
normal on screen.

## Status (2026-10-25)

| Phase | State |
|---|---|
| 0 Inventory | **Done.** Missing in Supabase: `live_wire_entries`, `site_counts`. Present: `team_ratings`, `team_adjusted_ratings`, `team_game_pps`, `team_defense_zone_stats`, `player_season_totals`, `team_shot_ratings`. `teams` has 365 D1 rows. |
| 1 Clean root | **Done.** Strays deleted, `team-shot-ratings.sql` moved to `supabase/`, chrome files in `app/`. |
| 2 Missing SQL | **YOU — not done.** Needs the Supabase SQL editor (no CLI or psql on this machine). Until it runs, the ticker and the home stats row don't render. |
| 3 One site | **Done.** `SiteChrome` (ticker + nav) is in the root layout; title template set. |
| 4 Verify ratings | **Mostly done.** Top 10 reads right (Michigan, Duke, Arizona, Florida, Gonzaga, Saint Louis, UConn, Illinois, Alabama, Louisville); Belmont is 24th, not near the top. `off_rk`/`def_rk` aren't in the view — the page computes them (`lib/ratings.ts`), so no SQL change needed. Not checked: the `refresh_adjusted_ratings` function body (`pg_proc` isn't readable through the API). |
| 5 Rankings page | **Done.** Built fresh at `app/rankings/` (the downloaded version never arrived). Overall / Offense / Defense tabs; Defense sorts ascending. Nav link enabled and renamed "Ratings · 2025-26", since these describe last season. |
| 2026-27 Top 25 | **Replaced.** The KenPom/Torvik/ESPN composite was removed on request; the site's Top 25 is now our own formula (below). |
| Our formula | **Live-ready 2026-10-26.** `/rankings` and the home Top 25 tab. Weights (rev. 2026-10-26): net efficiency 40% (65% projected roster / 35% last season's adjusted net), conference strength 22%, offense 8%, OREB% 8%, TO margin 8%, 3P% 7%, defense 7%; plus an identity bonus (+0.3 per SD past 2.5 SD) for elite offense or elite margins (OREB + TO). Tuned so ~17/25 overlap the major preseason lists while outliers survive. Preseason = roster projection from 2025-26 box scores (cached, no API calls). **In season:** run `npm run ncaa-stats` (NCAA.com official team totals, ~80 pages, 3 s apart, no API) then `npm run rank`; real numbers blend in at games/(games+10). NCAA.com has no schedule, so in-season stats are adjusted by conference peers. |
| Home page | **Rebuilt 2026-10-26.** Logo (`app/Logo.tsx`, `app/icon.svg`), intro write-up, no description cards. 2025-26 shooting-ratings view removed. |
| Live Wire content | **Seeded 2026-10-25** with 11 verified items (injuries, transfers, eligibility), each linked to its source. Seed placeholder unpublished. |
| 6 Posting news | **Option (a).** Use the saved SQL snippet below. |
| 7 Tabbed home | **Done — true tabs, as the owner asked.** `/` has Overview, Top 25, Shot charts, How it works. Each tab is a URL (`/?tab=top25`) and only its data is fetched. |
| Ticker toggle | **Done, unverified on screen.** Hide/Show button on the ticker's right edge; choice saved in localStorage and applied before first paint. Can't be seen until Phase 2 creates entries. |
| 8 Commit/push | **Committed locally. Push is YOU** — `gh` isn't installed. |
| 9 Deploy | **YOU — not started.** |

---

## Phase details (status above says which are left)

## Phase 0 — Find out what's actually there

Nothing below is worth doing on a wrong picture of the current state.

```bash
cd ~/Documents/cbb-website
git log --oneline -8
git status --short
ls app/ app/shot-chart/ app/rankings/ supabase/
```

Then in the Supabase SQL editor:

```sql
select table_name, table_type
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

**Write down which of these exist:** `live_wire_entries`, `site_counts`,
`team_ratings`, `team_adjusted_ratings`, `team_game_pps`,
`team_defense_zone_stats`, `player_season_totals`.

**Done when:** you have a list of what's missing. Everything after this
assumes you know.

---

## Phase 1 — Clean the project root

Loose downloads have accumulated in the repo root and at least one file
the code imports is missing entirely.

Delete the strays:

```bash
cd ~/Documents/cbb-website
rm -f defense-toggle-patch*.md one-site-patch*.md \
      "site-counts (1).sql" "site-counts (2).sql" \
      "team-defense-stats (1).sql"
```

Check nothing else is loitering:

```bash
ls *.md *.sql 2>/dev/null
```

Only `README.md` and `SETUP.md` should survive at the root. All `.sql`
belongs in `supabase/`.

Then put `SiteChrome.tsx` in place — it's imported by the one-site patch
but isn't in the folder:

```bash
mv ~/Downloads/SiteChrome.tsx app/SiteChrome.tsx
```

Confirm the other two chrome files are there too:

```bash
ls app/SiteChrome.tsx app/SiteNav.tsx app/site-chrome.css app/LiveWire.tsx
```

**Done when:** all four exist and the root is clean.

---

## Phase 2 — Run the missing SQL

Two files never ran, which is why the ticker is empty and the shot-count
line on the home page is hidden.

Order matters only in that `live_wire_entries` must exist before the
ticker queries it.

1. `supabase/live-wire.sql` — creates the table, the RLS policies, and
   seeds one row.
2. `supabase/site-counts.sql` — the headline counts matview.

For each: open in VS Code, `Cmd+A`, `Cmd+C`, then in Supabase `Cmd+A`,
Delete, `Cmd+V`, Run. The whole file. A partial paste gives "syntax
error at end of input."

Verify:

```sql
select id, kind, headline from live_wire_entries where is_live;
select * from site_counts where season = 2026;
```

**Done when:** the first returns at least the seed row, and the second
returns one row with `teams` = 365. If teams isn't 365, stop — the
`is_d1` flags are wrong and that number is about to go on a public page.

---

## Phase 3 — Make it one site

Apply the one-site patch (re-sent alongside this plan if you deleted it).
It moves the ticker and nav into the root layout so they appear on every
page instead of only the home page.

Summary of what it changes:

- `app/layout.tsx`: import `SiteChrome`, render it inside `<body>` above
  `{children}`; replace the "Create Next App" metadata.
- `app/page.tsx`: remove the `LiveWire` import, its query, and the
  `<LiveWire/>` element — the ticker is global now.
- `app/home.css`: delete the ticker block; those styles live in
  `site-chrome.css`. Two copies will drift.

**Done when:** `/` and `/shot-chart` both show the ticker and nav, the
browser tab no longer says "Create Next App", and the shot chart header
isn't crowded against the nav. If it is, `.wrap` in `shot-chart.css` has
top padding written when it was the first thing on the page.

---

## Phase 4 — Verify the ratings before showing anyone

**This is the step most likely to be skipped and most likely to embarrass
you.** The adjusted ratings had a sign error: the offensive adjustment
rewarded teams for playing *weak* defenses, which is the opposite of the
point. It may or may not have been fixed.

Check the function body:

```sql
select prosrc from pg_proc where proname = 'refresh_adjusted_ratings';
```

Look for the offensive line. It must read:

```
avg(g.off_pps + (lg_pps - r.adj_def))
```

If it reads `(r.adj_def - lg_pps)`, the sign is still inverted. Re-run
the corrected function from the chat and then:

```sql
select refresh_adjusted_ratings(2026);
```

Then the real test:

```sql
select rk, school, conference, adj_off, adj_def, net
from team_ratings where season = 2026 order by rk limit 25;
```

**Read the names, not the numbers.** The top ten should be teams that
were actually good in 2025-26. If Belmont, High Point, UT Rio Grande
Valley or Robert Morris are near the top, the schedule adjustment still
isn't biting and the ranking is not publishable.

Also confirm the view has the per-metric ranks the page needs:

```sql
select rk, off_rk, def_rk from team_ratings where season = 2026 limit 1;
```

If `off_rk` or `def_rk` don't exist, re-run the updated `team_ratings`
view definition.

**Done when:** the top 25 reads like a real top 25 and all three rank
columns exist.

---

## Phase 5 — The rankings page

Built: `app/rankings/page.tsx`, `RatingsTable.tsx` (shared with the home
page's Top 25 tab), `rankings.css`, and `lib/ratings.ts`. The original
instructions, if a downloaded version ever needs to replace these:

```bash
mkdir -p app/rankings
mv ~/Downloads/page.tsx app/rankings/page.tsx
mv ~/Downloads/rankings.css app/rankings/rankings.css
```

Careful — that download is named `page.tsx`, same as the home page. It
must land in `app/rankings/`.

Then enable the nav link: in `app/SiteNav.tsx`, change `ready: false` to
`ready: true` on the Top 25 line.

**Done when:** `/rankings` loads, all three tabs (Overall, Offense,
Defense) reorder the table, and the Defense tab sorts ascending because
fewer points allowed is better.

**Naming note:** these are points per *field goal attempt*, not points
per possession. Real PPP needs turnovers, offensive rebounds and free
throw attempts, none of which are in this data. The page says so. Don't
relabel it PPP without fetching box scores first.

---

## Phase 6 — A way to actually post injury news

The ticker has an `injury` kind already, but right now the only way to
add an entry is to open the SQL editor and write an insert. That won't
happen at 11pm when news breaks, which means the ticker will sit stale
and make the site look abandoned.

Two options, pick one:

**(a) SQL snippet, saved as a favourite.** Zero build time. Keep this in
Supabase's saved queries and edit the values each time:

```sql
insert into live_wire_entries (kind, headline, url, is_live)
values ('injury', 'Headline goes here', null, true);
```

**(b) A small admin page** at `/admin/wire` behind a password in an env
var, with a form that posts to a route handler using the secret key.
Perhaps an hour of work. Worth it only if you'll post more than a few
times a week.

Start with (a). Move to (b) when (a) annoys you.

**Note on scope:** there is no feed for college basketball transfer or
injury news. Everything in this ticker is typed by a person. That's an
honest design — the site shows what someone actually wrote — but it
means the ticker is as fresh as you make it.

**Done when:** you can add an entry and see it in the ticker within an
hour (the revalidate window), or immediately after a dev-server restart.

---

## Phase 7 — The tabbed home page

The current home page is a masthead plus two cards. The fuller version
from the original plan is a tabbed shell: Live Wire, Top 25, Shot
Charts.

Decide first, because it changes the build: **do the tabs swap content on
one page, or are they just links to the existing pages?**

- *Links* (what `SiteNav` does now) — already working, nothing to build,
  each section is its own URL and shareable.
- *True tabs* — one page, content swaps without navigating. Nicer feel,
  but the rankings and shot chart are server components with their own
  data, so this means either loading all of it up front or adding client
  fetching.

Recommendation: keep the nav as links, and make the home page a
**front page** instead — the five most recent Live Wire entries, the top
ten teams, and a link into each section. It reads as a landing page, it's
one query per block, and nothing has to be rebuilt as a client component.

If you want true tabs anyway, say so and that's a separate build.

**Decided: true tabs** (owner's request), done as URL-driven tabs so
nothing became a client component. **Done when:** `/` shows live content
rather than two static cards.

---

## Phase 8 — Commit and push

Everything above is uncommitted. Commit in groups so the history is
readable:

```bash
cd ~/Documents/cbb-website
git status --short          # look before you stage

git add app/SiteChrome.tsx app/SiteNav.tsx app/site-chrome.css \
        app/LiveWire.tsx app/layout.tsx app/page.tsx app/home.css
git commit -m "Shared site chrome: ticker and nav on every page"

git add app/rankings supabase/team-ratings-adjusted.sql
git commit -m "Opponent-adjusted team ratings and rankings page"

git add supabase/
git commit -m "Live Wire table with RLS, site counts view"
```

Then create the repo **private** and push. Either install the GitHub CLI
(`brew install gh && gh auth login`) and run:

```bash
gh repo create cbb-website --private --source=. --remote=origin --push
```

or create an empty private repo named `cbb-website` on github.com and run:

```bash
git remote add origin https://github.com/<you>/cbb-website.git
git push -u origin main
```

**Before pushing, confirm `.env.local` is not staged:**

```bash
git status --short | grep env
```

That should print nothing. If it prints anything, stop and fix
`.gitignore` first — keys in a git history are a rotation job, not a
delete job.

**Done when:** `gh repo view --web` opens a private repo with your code.

---

## Phase 9 — Deploy to Vercel

**Check Supabase first.** Two things will kill a live site:

1. The project showed "EXCEEDING USAGE LIMITS" in the dashboard earlier
   this month. Find out which limit and whether it matters under real
   traffic.
2. Free projects pause after about a week of inactivity — that's what
   broke the page today. A deployed site nobody visits will keep pausing,
   and a paused project means a dead site, not a slow one.

Neither blocks a deploy. Both decide whether the link you send someone
works when they open it.

Then:

1. vercel.com → Add New → Project → import the repo.
2. Framework preset: Next.js (it detects this).
3. **Environment Variables** — add every line from `.env.local`.
   `.env.local` is gitignored so it does not travel with the code, and a
   build without them fails at runtime with an unhelpful error. This is
   the step people forget.
4. Deploy.

**Done when:** the Vercel URL loads `/`, `/shot-chart` and `/rankings`
with real data, from a device that isn't your laptop.

---

## What's deliberately not in this plan

- **Live game data.** The CBBD budget is 1,000 calls a month across both
  their APIs, and the pipeline is built for backfilling a finished
  season. In-season updates are a separate design.
- **Real points per possession.** Needs box scores. Worth doing, costs
  API calls, changes what the rankings page can claim.
- **Returning-production weighting**, which is what would turn the
  2025-26 ratings into a 2026-27 projection. Needs roster data.
- **The dot plot.** `ShotDots.tsx` was deleted in `face923` and is
  recoverable with
  `git checkout 040a57f -- app/shot-chart/ShotDots.tsx`, but the page
  toggle that drove it was removed too.

---

## Standing notes

- Materialized views go stale after an ingest. Refresh order: baselines
  and priors first, then the stats views that depend on them, then
  `site_counts`, `team_game_pps`, and
  `select refresh_adjusted_ratings(2026);`.
- `zone_of()` exists in SQL and as `zoneOf()` in `lib/court.ts`. They
  must stay in sync or the page draws zones by one rule and colors them
  by another, with nothing on screen looking wrong.
- Matviews need explicit grants plus `notify pgrst, 'reload schema';` or
  PostgREST returns 200 and a blank page.
- `games` rows are stale for outcomes — `status` still says "scheduled"
  with null scores. The keys are fine. Anything needing scores must
  re-fetch.
