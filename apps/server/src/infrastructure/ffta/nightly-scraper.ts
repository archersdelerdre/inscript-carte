import type { ScraperRuns } from '../../application/scraper-runs.ts';

/** 3 a.m. in Paris: nobody registers then, and the FFTA site is quiet. */
const NIGHT_HOUR = 3;
const CHECK_EVERY_MS = 60_000;

const parisDayAndHour = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

/**
 * Starts one full run each night. Checks every minute rather than sleeping until 3 a.m.: a sleeping laptop or a
 * clock change cannot make it miss or double the night. A run already going (an admin's) is left alone.
 */
export function scheduleNightlyScraper(runs: ScraperRuns): () => void {
  let lastNight = '';
  const timer = setInterval(() => {
    const parts = Object.fromEntries(parisDayAndHour.formatToParts(new Date()).map(({ type, value }) => [type, value]));
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    if (Number(parts.hour) !== NIGHT_HOUR || day === lastNight) return;
    lastNight = day;
    void runs.start({ kind: 'full' }, null).then((result) => {
      if (result.ok) console.log(`Night FFTA scraper run ${result.run.id} started`);
      else console.log(`Night FFTA scraper run not started: ${result.reason}`);
    });
  }, CHECK_EVERY_MS);
  return () => clearInterval(timer);
}
