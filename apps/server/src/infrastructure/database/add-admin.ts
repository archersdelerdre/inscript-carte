import { MIN_ADMIN_PASSWORD_LENGTH } from '@inscript-carte/shared';

import { AdminAccounts } from '../../application/admin-accounts.ts';
import { BunPasswordHasher } from '../bun-password-hasher.ts';
import { config } from '../config.ts';
import { createDatabase } from './connection.ts';
import { SqliteAdminRepository } from './sqlite-admin-repository.ts';
import { SqliteArcherRepository } from './sqlite-archer-repository.ts';

const licenceNumber = Bun.argv[2]?.trim().toUpperCase();
if (!licenceNumber) {
  console.error('Usage: bun run db:add-admin <licence number>   (also changes the password of an existing admin)');
  process.exit(1);
}

/** Filled on first use when stdin is not a terminal (password piped in). */
let pipedLines: string[] | null = null;

const password = await askHidden(`Password (at least ${MIN_ADMIN_PASSWORD_LENGTH} characters): `);
if ((await askHidden('Same password again: ')) !== password) {
  console.error('The two passwords differ. Nothing changed.');
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
  const result = await accounts.setPassword(licenceNumber, password);
  // Personal data: the member's name is never printed.
  if (result.ok) {
    console.log(result.created ? `${licenceNumber} is now an admin.` : `Password of admin ${licenceNumber} changed.`);
  } else {
    console.error(
      result.reason === 'unknown_member'
        ? `No active member with licence number ${licenceNumber}. Import the member list first.`
        : `The password must have at least ${MIN_ADMIN_PASSWORD_LENGTH} characters. Nothing changed.`,
    );
    process.exitCode = 1;
  }
} finally {
  await database.destroy();
}

/** Reads one line without showing it. */
async function askHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    pipedLines ??= (await Bun.stdin.text()).split(/\r?\n/);
    process.stdout.write('\n');
    return pipedLines.shift() ?? '';
  }

  const { promise, resolve } = Promise.withResolvers<string>();
  let value = '';
  const onData = (chunk: string) => {
    for (const character of chunk) {
      if (character === '\u0003') process.exit(130); // Ctrl+C
      if (character === '\r' || character === '\n') {
        stdin.off('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write('\n');
        return resolve(value);
      }
      value = character === '\u007f' ? value.slice(0, -1) : value + character;
    }
  };
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.on('data', onData);
  stdin.resume();
  return promise;
}
