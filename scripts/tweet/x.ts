/**
 * Posting to X (Twitter): one image, one post.
 *
 * Signs requests with OAuth 1.0a, the scheme for a bot that posts as its
 * own account. Needs four values from the X developer portal, in
 * .env.local and as GitHub repository secrets:
 *
 *   X_API_KEY, X_API_SECRET              the app ("Consumer Keys")
 *   X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET  the account, with Read and
 *                                          Write permission
 *
 * X bills per post (about 1.5 cents) and charges far more for a post
 * with a link in it (20 cents as of 2026), so the posts carry no URLs.
 */

import { createHmac, randomBytes } from "node:crypto";

const API = "https://api.x.com/2";

export const X_KEYS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"] as const;

export type XCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

/** The four credentials, or the names of the ones that aren't set. */
export function xCredentials(): XCredentials | { missing: string[] } {
  const missing = X_KEYS.filter((k) => !process.env[k]);
  if (missing.length) return { missing };
  return {
    apiKey: process.env.X_API_KEY!,
    apiSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET!,
  };
}

/** Upload a PNG and post it with `text`. Returns the new post's id. */
export async function postWithImage(creds: XCredentials, text: string, png: Buffer) {
  const upload = await call<{ data?: { id?: string } }>(creds, `${API}/media/upload`, {
    media: png.toString("base64"),
    media_category: "tweet_image",
  });
  const mediaId = upload.data?.id;
  if (!mediaId) throw new Error(`X accepted the image but returned no media id: ${JSON.stringify(upload)}`);

  const post = await call<{ data?: { id?: string } }>(creds, `${API}/tweets`, {
    text,
    media: { media_ids: [mediaId] },
  });
  if (!post.data?.id) throw new Error(`X returned no post id: ${JSON.stringify(post)}`);
  return post.data.id;
}

async function call<T>(creds: XCredentials, url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(creds, "POST", url),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401
        ? " Check the four X_ values; the access token must be generated after the app was set to Read and Write."
        : res.status === 403
          ? " The app or its access token may be read-only, or the post duplicates the last one."
          : res.status === 402 || res.status === 429
            ? " The X account may be out of API credits, or over its rate limit."
            : "";
    throw new Error(`X ${new URL(url).pathname} ${res.status}: ${text.slice(0, 400)}${hint}`);
  }
  return JSON.parse(text) as T;
}

/**
 * The OAuth 1.0a Authorization header. A JSON body isn't part of the
 * signature; query and form parameters are, so they're passed in `params`
 * (unused by the two calls above, which have neither).
 */
export function authHeader(
  creds: XCredentials,
  method: string,
  url: string,
  params: Record<string, string> = {},
  // Fixed only by the self-test; real calls take the defaults.
  nonce = randomBytes(16).toString("hex"),
  timestamp = Math.floor(Date.now() / 1000).toString(),
) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const signed = Object.entries({ ...params, ...oauth })
    .map(([k, v]) => [enc(k), enc(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), enc(url), enc(signed)].join("&");
  const key = `${enc(creds.apiSecret)}&${enc(creds.accessTokenSecret)}`;
  oauth.oauth_signature = createHmac("sha1", key).update(base).digest("base64");
  return (
    "OAuth " +
    Object.entries(oauth)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
      .join(", ")
  );
}

/** RFC 3986 percent-encoding, which is stricter than encodeURIComponent. */
function enc(s: string) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * How long X will count `text` as: most characters are 1, but emoji and
 * CJK count 2. The limit is 280.
 */
export function xLength(text: string) {
  let n = 0;
  for (const ch of text.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    const single =
      c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
    n += single ? 1 : 2;
  }
  return n;
}
