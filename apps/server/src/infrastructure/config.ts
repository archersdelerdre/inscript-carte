export const config = {
  port: Number(Bun.env.PORT ?? 3998),
  databasePath: Bun.env.DATABASE_PATH ?? 'data/inscript-carte.sqlite',
  /** Built client (`apps/client/dist`) to serve next to the API, so one port is enough. Unset in development. */
  clientDistPath: Bun.env.CLIENT_DIST_PATH ?? null,
  /** The `chrome-headless-shell` binary the FFTA scraper drives. Only the scraper needs it. */
  chromePath: Bun.env.CHROME_PATH ?? null,
  /**
   * `1` in the Docker image only: a container gives Chrome no user namespaces, so its sandbox cannot start. Chrome
   * only opens www.ffta.fr pages there, as the non-root `bun` user. Leave unset elsewhere.
   */
  chromeNoSandbox: Bun.env.CHROME_NO_SANDBOX === '1',
  /** Without it the scraper still stores the competitions; their mandates wait for a key. Never logged. */
  openRouterApiKey: Bun.env.OPENROUTER_API_KEY || null,
  /** The LLM reading the mandates (OpenRouter model id); the user chose GLM 5.3 Flash (2026-10-09). */
  mandateModel: Bun.env.MANDATE_MODEL ?? 'z-ai/glm-5.3-flash',
};
