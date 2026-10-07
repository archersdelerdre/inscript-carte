export const config = {
  port: Number(Bun.env.PORT ?? 3000),
  databasePath: Bun.env.DATABASE_PATH ?? 'data/inscript-carte.sqlite',
};
