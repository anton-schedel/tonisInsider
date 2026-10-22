declare const __BUILD_ID__: string;

/** One id per build (set in astro.config.mjs): pages from different deploys can tell they differ. */
export const BUILD_ID = __BUILD_ID__;
