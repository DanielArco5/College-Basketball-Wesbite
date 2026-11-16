# Updating the site

Most of it updates itself. This is what you do by hand, and where.

## Runs on its own (GitHub Actions)

| What | When | Where to check |
|---|---|---|
| Live Wire news (ESPN, CBS Sports) | Every 3 hours | GitHub → Actions → **Live Wire news** |
| Shot charts and Top 25: today's finished games | Several times a day (scheduled hourly; GitHub runs about 4) | GitHub → Actions → **Daily update** |
| Box scores, player stats, yesterday's late games | Once a day, in the first run after 3 a.m. ET; retried by the next run if it fails | GitHub → Actions → **Daily update** |
| Scores and top scorers in the ticker | Live, every 2 minutes | Nothing to do |
| X posts: yesterday's hot and cold shooters | Once a day, first run after 6 a.m. ET | The **Post to X** step of Daily update |
| X posts: an unusual team shot chart | Every third day, first run after noon ET | Same |

To run either job now: Actions → pick the job → **Run workflow**. Running
Daily update by hand also pulls in today's games that have finished.
GitHub's scheduled runs often start late, sometimes by hours.
A red ✗ there means a run failed; click it to see why. The site keeps
showing the last good data in the meantime.

## Change the Top 25 by hand

Supabase → **Table Editor** → `top25_overrides` → **Insert row**:

- `school`: as the site spells it (`UConn`, `St. John's`, `Miami`)
- `rank`: 1–25, 26–35 for honorable mentions, `0` to drop a team
- `note`: optional; shows when someone hovers the "Our pick" tag

It shows on the site within 5 minutes. To undo, uncheck `is_active` or
delete the row. Teams you don't pin keep the formula's daily order.

## Post your own Live Wire item

Supabase → **Table Editor** → `live_wire_entries` → **Insert row**:

- `kind`: `injury`, `transfer`, `commitment` or `note`
- `headline`: one line
- `url`: link to the source (optional)
- `is_live`: check it, or it stays a hidden draft

Injuries from the past week run right after the scores, so a big injury
gets seen. To pull a bad auto-fetched headline, uncheck its `is_live`.

## The X (Twitter) account

One-time setup, about ten minutes:

1. Sign in to the X developer site (developer.x.com) as the account
   that should post. Create an app, and add API credits: X bills per
   post, about 1.5 cents each when this was written, so roughly $3 a
   season. Check the current price there.
2. In the app's settings, set user authentication to **Read and Write**.
3. Under Keys and tokens, generate the **API Key and Secret** and the
   **Access Token and Secret**. Generate the access token *after* step 2,
   or it will be read-only.
4. GitHub → Settings → Secrets and variables → Actions → add four
   secrets: `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
   `X_ACCESS_TOKEN_SECRET`. (Add the same four lines to `.env.local` to
   post from your own machine.)

Until the secrets exist, the job skips posting and nothing breaks.

See a post before it goes out; this sends nothing and saves the image
to `out/tweets/`:

```
npm run tweet -- shooters                    # yesterday
npm run tweet -- shooters --date 2026-11-14
npm run tweet -- chart                       # the next team it would pick
npm run tweet -- chart --team "Alabama"
```

Add `--post` to send that one by hand. To change the rules: the shot
minimum is `MIN_SHOTS` in `scripts/tweet/shooters.ts`; how often a chart
goes out is `CHART_EVERY_DAYS` in `scripts/tweet.ts`. Posts carry no
links on purpose: X charges 20 cents for a post with a link.

## Change code or design

Edit locally (or ask Claude), then:

```
cd ~/Documents/cbb-website
git add -A
git commit -m "what changed"
git push
```

Vercel redeploys on every push, in a minute or two.

## Never

- Commit `.env.local` (it's ignored; keep it that way).
- Put the service-role key anywhere with a `NEXT_PUBLIC_` name.
