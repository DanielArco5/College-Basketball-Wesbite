import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client.
 *
 * Uses the secret key, which bypasses RLS. This must never be imported
 * into a client component — keep it behind server components and route
 * handlers only. If you need browser-side reads later, make a separate
 * client with the publishable key and write read policies for the
 * tables it touches.
 */
export function createServerClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}
