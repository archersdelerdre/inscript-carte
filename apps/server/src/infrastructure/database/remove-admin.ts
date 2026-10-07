import { AdminAccounts } from '../../application/admin-accounts.ts';
import { BunPasswordHasher } from '../bun-password-hasher.ts';
import { config } from '../config.ts';
import { createDatabase } from './connection.ts';
import { SqliteAdminRepository } from './sqlite-admin-repository.ts';
import { SqliteArcherRepository } from './sqlite-archer-repository.ts';

const licenceNumber = Bun.argv[2]?.trim().toUpperCase();
if (!licenceNumber) {
  console.error('Usage: bun run db:remove-admin <licence number>');
  process.exit(1);
}

const database = createDatabase(config.databasePath);
try {
  await database.migrate.latest();
  const accounts = new AdminAccounts(
    new SqliteArcherRepository(database),
    new SqliteAdminRepository(database),
    new BunPasswordHasher(),
  );
  if (await accounts.remove(licenceNumber)) {
    console.log(`${licenceNumber} is no longer an admin; their admin sessions are closed.`);
  } else {
    console.error(`${licenceNumber} is not an admin.`);
    process.exitCode = 1;
  }
} finally {
  await database.destroy();
}
