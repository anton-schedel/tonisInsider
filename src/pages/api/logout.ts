import { clearSession, logoutRoute } from "../../lib/session.ts";

export const prerender = false;

export const POST = logoutRoute(clearSession);
