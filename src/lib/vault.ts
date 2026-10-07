// AES-GCM encryption for the "stay logged in" cookie. The key is a Worker secret (CREDENTIALS_KEY,
// 32 random bytes, base64) and never leaves Cloudflare; the sealed value only lives in the user's browser.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = fromB64(keyB64);
  if (raw.length !== 32) throw new Error("CREDENTIALS_KEY must be 32 bytes (base64)");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypts text → "iv.ciphertext" (base64url). */
export async function seal(text: string, keyB64: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(text)));
  return `${toB64url(iv)}.${toB64url(ct)}`;
}

/** Decrypts a sealed value; undefined if the key is wrong, the value was tampered with or is malformed. */
export async function unseal(sealed: string, keyB64: string): Promise<string | undefined> {
  try {
    const [iv, ct] = sealed.split(".");
    if (!iv || !ct) return undefined;
    const key = await importKey(keyB64);
    return decoder.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ct)));
  } catch {
    return undefined;
  }
}
