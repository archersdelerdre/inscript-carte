/**
 * Reads every upcoming mandate again, even the files already read: after a change of what is asked to the LLM (the
 * rhythm, 2026-10-11). `bun run mandate:reread-all [--limit N] [--ids 26337,27169]`: `--ids` reads only those (the
 * ones a previous run reported; a failed forced re-read keeps the old reading, so nothing in the database says which
 * failed). Needs `OPENROUTER_API_KEY` and poppler. Prints counts and FFTA ids only. Not while a calendar update runs:
 * both would write the same readings.
 */
import { MAX_MANDATE_ATTEMPTS, ReadMandates } from '../../application/read-mandates.ts';
import { config } from '../config.ts';
import { createDatabase } from '../database/connection.ts';
import { SqliteMandateStore } from '../database/sqlite-mandate-store.ts';
import { SystemClock } from '../system-clock.ts';
import { OpenRouterMandateExtractor } from './openrouter-mandate-extractor.ts';
import { PdfMandateFetcher } from './pdf-mandate-fetcher.ts';

function option(name: string): string | undefined {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? undefined : Bun.argv[index + 1];
}

const limit = Number(option('--limit') ?? Infinity);
const idsText = option('--ids');
const fftaIds = idsText
  ?.split(',')
  .map((id) => id.trim())
  .filter(Boolean);
if (!config.openRouterApiKey || !(limit > 0) || (idsText !== undefined && !fftaIds?.length)) {
  console.error('Usage: OPENROUTER_API_KEY=… bun run mandate:reread-all [--limit N] [--ids 26337,27169]');
  process.exit(1);
}

const clock = new SystemClock();
const database = createDatabase(config.databasePath);
const readMandates = new ReadMandates(
  new PdfMandateFetcher(),
  new OpenRouterMandateExtractor(config.openRouterApiKey, config.mandateModel, config.mandateFallbackModel),
  new SqliteMandateStore(database),
  clock,
);
try {
  const counts = await readMandates.run({
    today: clock.today(),
    force: true,
    fftaIds,
    limit,
    onProgress: (done, total) => {
      if (done % 20 === 0 || done === total) console.log(`${done} / ${total}`);
    },
    onProblem: (fftaId, problem) => console.log(`${fftaId}: ${problem}`),
  });
  console.log(
    `Read: ${counts.read}, refused: ${counts.invalid}, failed: ${counts.failed} (tried again by the next runs, up to ${MAX_MANDATE_ATTEMPTS} times), left: ${counts.left}, cost: $${counts.costUsd.toFixed(3)}`,
  );
} finally {
  await database.destroy();
}
