/** One id per build (the module runs once while building): pages from different deploys can tell they differ. */
export const BUILD_ID = Date.now().toString(36);
