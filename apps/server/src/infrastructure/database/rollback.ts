import { config } from '../config.ts';
import { createDatabase } from './connection.ts';

const database = createDatabase(config.databasePath);
try {
  const [batch, names] = await database.migrate.rollback();
  console.log(names.length === 0 ? 'Nothing to roll back.' : `Rolled back batch ${batch}: ${names.join(', ')}`);
} finally {
  await database.destroy();
}
