// The coach's login on /schnoeselmob/: one shared password (Worker secret COACH_PASSWORD), then a signed cookie
// "<expiry ms>.<HMAC-SHA256 of it>" with CREDENTIALS_KEY, so the Worker needs no session store.

export const COACH_COOKIE = "coach";
export const COACH_DAYS = 90;
/** Wrong passwords per IP before a pause (coach_login in D1). */
export const LOGIN_RATE = { count: 5, windowMs: 10 * 60_000 };

const encoder = new TextEncoder();

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function mac(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", encoder.encode(`coach|${key}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", k, encoder.encode(text)));
}

export async function signCoach(key: string, now: number): Promise<string> {
  const expiry = String(now + COACH_DAYS * 86_400_000);
  return `${expiry}.${await mac(key, expiry)}`;
}

export async function isCoach(value: string | undefined, key: string | undefined, now: number): Promise<boolean> {
  if (!value || !key) return false;
  const [expiry, sig] = value.split(".");
  if (!expiry || !sig || !(Number(expiry) > now)) return false;
  return same(sig, await mac(key, expiry));
}

/** Constant-time string comparison. */
function same(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function passwordMatches(given: string, expected: string | undefined): boolean {
  return !!expected && !!given && same(given, expected);
}
