import type { Clock } from '../../application/ports/clock.ts';
import type { ScraperLauncher, ScraperRunStore } from '../../application/ports/scraper-run-store.ts';

const SCRAPE_SCRIPT = new URL('./scrape.ts', import.meta.url).pathname;
/** Lower priority than the server, so visitors are always served first; `nice` is in every Linux image and macOS. */
const NICE = Bun.which('nice');

/** Runs `scrape.ts --run <id>` as its own process: a crash or a leak there never takes the server down. */
export class ProcessScraperLauncher implements ScraperLauncher {
  readonly #store: ScraperRunStore;
  readonly #clock: Clock;

  constructor(store: ScraperRunStore, clock: Clock) {
    this.#store = store;
    this.#clock = clock;
  }

  launch(runId: number): void {
    const command = [process.execPath, SCRAPE_SCRIPT, '--run', String(runId)];
    const child = Bun.spawn(NICE ? [NICE, '-n', '10', ...command] : command, {
      env: process.env,
      // The run's row holds its progress and report; only errors reach the server's log.
      stdout: 'ignore',
      stderr: 'inherit',
    });
    // The process finishes its row itself; if it died first (killed, out of memory), say so.
    void child.exited.then((code) =>
      this.#store.failIfRunning(runId, `Le processus s'est arrêté sans finir (code ${code}).`, this.#clock.now()),
    );
  }
}
