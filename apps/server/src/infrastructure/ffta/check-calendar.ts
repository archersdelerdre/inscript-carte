/**
 * Reads the whole FFTA calendar and prints what it found, writing nothing: to check that the site can still be read
 * (Cloudflare, markup changes) before trusting a real run. `--details N` also reads N detail pages spread over the
 * list. Prints counts only: no names, emails or phone numbers. Needs `CHROME_PATH` (see AGENTS.md).
 */
import { parseArgs } from 'node:util';

import { config } from '../config.ts';
import { SystemClock } from '../system-clock.ts';
import { FftaBrowser } from './ffta-browser.ts';
import { readCalendar, readCompetition } from './ffta-calendar.ts';
import { departmentFromPostalCode } from './ffta-department.ts';

const { values: options } = parseArgs({ options: { details: { type: 'string', default: '0' } } });
const detailCount = Number(options.details);

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

  if (detailCount > 0) {
    const step = Math.max(1, Math.floor(competitions.length / detailCount));
    const sample = competitions.filter((_, index) => index % step === 0).slice(0, detailCount);
    const sources: string[] = [];
    const detailProblems: string[] = [];
    let withPosition = 0;
    let disagreements = 0;
    for (const [index, listed] of sample.entries()) {
      process.stdout.write(`\rDetail ${index + 1}/${sample.length}`);
      const { detail, problems: found } = await readCompetition(browser, listed.fftaId);
      detailProblems.push(...found);
      if (!detail) continue;
      if (detail.position) withPosition++;
      if (!detail.departmentCode) sources.push('none');
      else if (detail.postalCode && departmentFromPostalCode(detail.postalCode)) sources.push('postal code');
      else sources.push('committee');
      const same = ['startDate', 'endDate', 'status', 'discipline'] as const;
      if (same.some((key) => detail[key] !== listed[key])) {
        disagreements++;
        detailProblems.push(`${listed.fftaId} : la liste et la fiche ne disent pas la même chose`);
      }
    }
    console.log(`\n${sample.length} detail pages: département from`, tally(sources));
    console.log(`With a map position: ${withPosition}, list and detail disagree: ${disagreements}`);
    console.log(detailProblems.length === 0 ? 'No problem.' : detailProblems.join('\n'));
  }
} finally {
  await browser.close();
}
