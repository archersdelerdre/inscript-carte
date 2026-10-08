export const config = {
  port: Number(Bun.env.PORT ?? 3998),
  databasePath: Bun.env.DATABASE_PATH ?? 'data/inscript-carte.sqlite',
  /** Built client (`apps/client/dist`) to serve next to the API, so one port is enough. Unset in development. */
  clientDistPath: Bun.env.CLIENT_DIST_PATH ?? null,
  /** The `chrome-headless-shell` binary the FFTA scraper drives. Only the scraper needs it. */
  chromePath: Bun.env.CHROME_PATH ?? null,
};
