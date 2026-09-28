# CBB Website — Setup

Everything needed to get from a fresh clone to verified shot data in the database.

---

## 0. Naming

On disk the folder is `cbb-website` (lowercase, hyphenated). `create-next-app`
rejects capitals and spaces because it derives the npm package name from the
directory.

"CBB Website" is the display name — use it for the GitHub repo title, the
Supabase project, the Vercel project, and the `<title>` in `app/layout.tsx`.

---

## 1. Credentials

Three secrets. One from CollegeBasketballData, two from Supabase.

### CBBD API key

Request at `collegebasketballdata.com/key`. Arrives by email.

**One key covers both CBBD and CFBD.** Same operator, unified auth — if you
already had a College *Football* Data key, that's the one. The hosts are still
separate:

- basketball → `https://api.collegebasketballdata.com`
- football   → `https://api.collegefootballdata.com`

Pasting a football example off their blog is the classic failure: auth header
looks fine, every basketball path 404s.

Free tier is **1,000 calls/month**, and the quota is almost certainly shared
across both APIs since it's one account. Budget accordingly.

### Supabase keys

Dashboard → Settings → API:

- Project URL
- `anon` key — public, safe in the browser, used by the frontend later
- `service_role` key — **secret**, bypasses every RLS policy, ingestion only

---

## 2. `.env.local`

Create in the project root. This file is where the real values go — nowhere
else, and never in a committed file.

```
CBBD_API_KEY=<paste your CBBD key here>

SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste your service_role key here>

NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste your anon key here>
```

No quotes, no spaces around `=`.

**The `service_role` key must never get a `NEXT_PUBLIC_` prefix** and must never
be imported into anything under `app/`. That prefix ships the value to every
visitor's browser.

Verify git is ignoring it before your first commit:

```bash
git check-ignore -v .env.local
```

A line pointing at `.gitignore` means you're safe. Silence means it is **not**
ignored — add `.env*.local` to `.gitignore` immediately.

---

## 3. Install

```bash
npm install @supabase/supabase-js
npm install -D tsx
```

Add to `package.json`:

```json
"scripts": {
  "ingest": "tsx --env-file=.env.local scripts/ingest-shots.ts"
}
```

`--env-file` requires Node 20.6+. On older Node: `npm i -D dotenv` and add
`import "dotenv/config"` to the top of the ingest script instead.

---

## 4. Database

Supabase dashboard → SQL Editor → paste `supabase/schema.sql` → Run.

Expect eight tables and three views. Keep the file in version control even
though you ran it through the dashboard — when something breaks in month two,
the dashboard won't tell you what the table used to look like.

---

## 5. Verify auth before anything else

Cheapest possible test. `/conferences` is a tiny payload.

```bash
curl -s -H "Authorization: Bearer $CBBD_API_KEY" \
  https://api.collegebasketballdata.com/conferences | head -c 300
```

Export the key into your shell first rather than pasting it inline — an inline
key lands in `~/.bash_history`.

| Response | Meaning |
|---|---|
| JSON array of conferences | Working. Proceed. |
| `401` / Unauthorized | Bad key, or a stray newline/space in `.env.local` |
| `404` | Wrong host — check it says `basketball` |
| Nothing | Network, or the URL is malformed |

Do this with curl, not the script. If the script fails first, you're debugging
the key, Supabase, the schema, and the parsing simultaneously.

---

## 6. First ingest

One date. Pick a Saturday in January for a full slate.

```bash
npm run ingest -- --season 2026 --date 2026-01-17
```

Output is one line: shots, games, and rows dropped for missing coordinates.
Some drops are normal — low-major games often have no tracking at all.

---

## 7. Verify the data, not just the row count

This is the real goal. "Rows landed" is not the same as "rows are correct."

```sql
-- Does your geometry agree with CBBD's own labels?
select cbbd_range,
       count(*)               as shots,
       round(avg(dist_ft), 1) as avg_dist,
       round(min(dist_ft), 1) as min_dist,
       round(max(dist_ft), 1) as max_dist
from shot_events
group by cbbd_range
order by avg_dist;
```

Pass conditions:

- `rim` rows average roughly **2–4 ft**, max under ~10 ft
- nothing tagged `rim` shows up 30 ft out (if it does, the half-court mirroring
  is broken)
- no `x` value exceeds 47
- overall made-shot rate lands in the mid-40s percent

```sql
-- Confirm the raw archive is populating — this is your Step 3 failover
select endpoint, row_count, fetched_at
from ingest_raw
order by fetched_at desc
limit 5;
```

If `ingest_raw` is empty, the failover has nothing to fall back on.

---

## 8. Full backfill

Once one date checks out clean:

```bash
npm run ingest -- --season 2026 --from 2025-11-03 --to 2026-04-06
```

~150 calls, roughly three minutes of built-in rate-limit sleeps. If it dies
partway, fix the cause and rerun with `--resume` — it picks up from the
checkpoint rather than restarting.

Fetching by date rather than by team is deliberate: `/plays/team` returns both
teams' plays, so looping 364 teams pulls every game twice and burns ~364 calls
for the same data.

---

## If you ever leak a key

Rotate it, don't just delete the commit. Git history keeps it.

- CBBD: regenerate at `collegebasketballdata.com/key`
- Supabase: Settings → API → roll the `service_role` key
