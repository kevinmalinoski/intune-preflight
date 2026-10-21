/// <reference types="vite/client" />

/**
 * The build-time flags that pick which of the three data sources ships, and the
 * one deploy-time value the live build cannot derive. Declared rather than left
 * to `vite/client`'s index signature so a typo in a flag name is a build error
 * and so this file is the list of them.
 */
interface ImportMetaEnv {
  /** `1` builds the self-contained public demo: the engine over bundled sample data. */
  readonly VITE_STATIC_DEMO?: string;
  /** `live` builds the delegated-auth browser app: MSAL sign-in, Graph read, no backend. */
  readonly VITE_MODE?: string;
  /**
   * Overrides the redirect URI the live build sends to Entra. Only needed when
   * the deployed URL is not `origin + BASE_URL` -- a reverse proxy, or a path
   * that differs from the one the bundle was built for. See authConfig.ts.
   */
  readonly VITE_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
