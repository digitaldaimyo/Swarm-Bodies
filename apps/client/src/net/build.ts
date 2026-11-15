/** Build identity, injected by vite.config.ts (`define`); "dev" outside a Vite build (tests). */
export const BUILD = {
  commit: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "dev",
  date: typeof __BUILD_DATE__ === "string" ? __BUILD_DATE__ : "dev",
};
