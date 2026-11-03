-- Start the GitHub Actions jobs on time, from Supabase.
--
-- GitHub's own cron starts runs late (often by hours) and sometimes skips
-- them, so the workflows no longer schedule themselves. Supabase's pg_cron
-- calls GitHub's "Run workflow" API instead, on the minute.
--
-- One-time setup:
--   1. GitHub -> Settings -> Developer settings -> Fine-grained tokens ->
--      Generate new token. Repository access: only
--      College-Basketball_Website. Permissions: Actions -> Read and write.
--      Pick the longest expiration offered.
--   2. Paste the token into the vault line below, then run this whole file
--      in the Supabase SQL editor. Safe to run again (e.g. with a new token).
--
-- Check it's working:
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select created, status_code, content from net._http_response
--     order by created desc limit 10;   -- 204 = GitHub accepted the run

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The token lives encrypted in Vault, never in a table or in git.
do $$
begin
  if exists (select 1 from vault.secrets where name = 'github_actions_token') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'github_actions_token'),
      'PASTE_GITHUB_TOKEN_HERE');
  else
    perform vault.create_secret('PASTE_GITHUB_TOKEN_HERE', 'github_actions_token');
  end if;
end $$;

-- Not in `public`, so the site's API can't call it.
create schema if not exists private;

create or replace function private.run_workflow(workflow text, mode text default null)
returns bigint
language sql
as $$
  select net.http_post(
    url := 'https://api.github.com/repos/DanielArco5/College-Basketball_Website/actions/workflows/'
           || workflow || '/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'github_actions_token'),
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'cbb-website-cron'),
    body := case when mode is null then '{"ref":"main"}'::jsonb
                 else jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('mode', mode)) end
  );
$$;

revoke all on function private.run_workflow(text, text) from public, anon, authenticated;

-- Times are UTC. Same hours the workflows used to schedule themselves.
-- Morning, 7:15 a.m. Eastern in fall (6:15 in winter): yesterday's games,
-- NCAA stats, player stats, Top 25 re-rank.
select cron.schedule('cbb-morning', '15 11 * * *',
  $$select private.run_workflow('daily.yml', 'morning')$$);
-- Hourly, 12:30 p.m. to 1:30 a.m. Eastern: today's finished games, shots only.
select cron.schedule('cbb-hourly', '30 0-6,17-23 * * *',
  $$select private.run_workflow('daily.yml', 'hourly')$$);
-- Every 3 hours: Live Wire headlines.
select cron.schedule('cbb-news', '40 */3 * * *',
  $$select private.run_workflow('news.yml')$$);
