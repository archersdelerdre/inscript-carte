/**
 * Reads the whole FFTA calendar and prints what it found, writing nothing: to check that the site can still be read
 * (Cloudflare, markup changes) before trusting a real run. Needs `CHROME_PATH` (see AGENTS.md).
 */
import { config } from '../config.ts';
import { SystemClock } from '../system-clock.ts';
import { FftaBrowser } from './ffta-browser.ts';
import { readCalendar } from './ffta-calendar.ts';

if (!config.chromePath) {
  console.error('CHROME_PATH is not set: install chrome-headless-shell first (see AGENTS.md).');
  process.exit(1);
}

const tally = (values: readonly string[]) =>
  Object.fromEntries(
    [
      ...values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string, number>()),
    ].toSorted((a, b) => b[1] - a[1]),
  );

const started = performance.now();
const browser = await FftaBrowser.open(config.chromePath);
try {
  const { competitions, pages, problems } = await readCalendar(browser, new SystemClock().today(), (page, found) =>
    process.stdout.write(`\rPage ${page}: ${found} entries`),
  );
  console.log(`\n${pages} pages read in ${Math.round((performance.now() - started) / 1000)} s`);
  console.log(
    `${competitions.length} competitions (Para-tir merged), ${competitions.filter((c) => c.hasParaTir).length} with Para-tir`,
  );
  console.log('Status:', tally(competitions.map(({ status }) => status)));
  console.log('Discipline:', tally(competitions.map(({ discipline }) => discipline)));
  console.log(`With a mandate: ${competitions.filter(({ mandateUrl }) => mandateUrl).length}`);
  console.log(problems.length === 0 ? 'No problem.' : `${problems.length} problem(s):\n${problems.join('\n')}`);
} finally {
  await browser.close();
}
