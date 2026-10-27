import { clearLigaSession, logoutRoute } from "../../lib/session.ts";

export const prerender = false;

export const POST = logoutRoute(clearLigaSession);
