import { env } from "cloudflare:workers";
import { ligaCredentials, type CookieJar } from "./session.ts";
import { chatAccount } from "./chats.ts";
import { recordWrite, type ChatWrite } from "./chatsDb.ts";
import { chatPlace } from "./chatsPlace.ts";
import { loadAppFeed } from "./snapshotServer.ts";

/**
 * Whose chats: the LigaInsider login in the sealed "stay logged in" cookie (lic), which only the Worker can read
 * (the app carries the same cookie inside its token). Never the readable name cookie.
 */
export async function accountOf(cookies: CookieJar): Promise<string | undefined> {
  const key = env.CREDENTIALS_KEY;
  const creds = await ligaCredentials(cookies, key);
  return creds && key ? chatAccount(creds.u, key) : undefined;
}

/** Remembers a write for "Deine Chats". Signed out of LigaInsider, nothing; it never makes the write fail. */
export async function recordChat(cookies: CookieJar, url: URL, w: Omit<ChatWrite, "place">): Promise<void> {
  try {
    const db = env.COMMENTS;
    const account = db && (await accountOf(cookies));
    if (!db || !account) return;
    await recordWrite(db, account, { ...w, place: chatPlace(await loadAppFeed(url), w.thread) }, new Date());
  } catch (err) {
    // Only the kind of failure: no account, no text.
    console.warn(`chats: not recorded: ${err instanceof Error ? `${err.constructor.name}: ${err.message}` : "unknown"}`);
  }
}
