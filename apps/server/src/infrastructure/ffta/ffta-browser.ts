import puppeteerCore, { type Browser, type Page } from 'puppeteer-core';
import { addExtra } from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

/** One page at a time, with this pause between two: the FFTA site is read slowly, like a person would. */
const PAUSE_BETWEEN_PAGES_MS = 1000;
const PAGE_TIMEOUT_MS = 30_000;
/** Cloudflare shows this title while it checks the browser, and keeps it when it refuses. */
const CLOUDFLARE_TITLE = 'Just a moment';

/**
 * The only places Chrome may reach: the FFTA site and all its subdomains (`www.`, `extranet.`…), and Cloudflare's
 * harder check (Turnstile), which the FFTA's Cloudflare can show. On 2026-10-08 the pages only called www and
 * extranet.ffta.fr. Everything else is refused: Chrome runs without its sandbox in Docker, this keeps it on one site.
 */
const ALLOWED_DOMAINS = ['ffta.fr'];
const ALLOWED_HOSTS = ['challenges.cloudflare.com'];
/** Content made inside the page itself: nothing is downloaded. */
const LOCAL_SCHEMES = ['data:', 'blob:', 'about:'];

/** `https` only, and the exact host or one of its subdomains: "evilffta.fr" or "ffta.fr.evil.com" are refused. */
export function isAllowedUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (LOCAL_SCHEMES.includes(parsed.protocol)) return true;
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  return (
    ALLOWED_HOSTS.includes(host) || ALLOWED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  );
}

/** Cloudflare refused the browser: nothing read after this can be trusted. */
export class CloudflareBlockedError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`Cloudflare blocked ${url}`);
    this.url = url;
  }
}

const puppeteer = addExtra(puppeteerCore);
// Without it, Cloudflare stops a headless browser on its "Just a moment…" page (tested 2026-10-08).
puppeteer.use(StealthPlugin());

/** A headless Chrome (`chrome-headless-shell`) reading www.ffta.fr, which is behind Cloudflare. */
export class FftaBrowser {
  readonly #browser: Browser;
  readonly #page: Page;
  #lastRequestAt = 0;

  private constructor(browser: Browser, page: Page) {
    this.#browser = browser;
    this.#page = page;
  }

  static async open(executablePath: string, { noSandbox = false } = {}): Promise<FftaBrowser> {
    const browser: Browser = await puppeteer.launch({
      executablePath,
      headless: true,
      // Talk to Chrome through a pipe: when the scraper process dies (even `kill -9`), the pipe closes and Chrome
      // quits by itself instead of staying in memory (seen with the default WebSocket, 2026-10-08).
      pipe: true,
      // Docker gives /dev/shm only 64 MB, too little for Chrome. No sandbox only where it cannot start (`config`).
      args: ['--disable-dev-shm-usage', ...(noSandbox ? ['--no-sandbox'] : [])],
    });
    const page = await browser.newPage();
    // Only the HTML is needed: images, fonts and videos are not downloaded; and nothing outside the FFTA's site.
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const isMedia = ['image', 'font', 'media'].includes(request.resourceType());
      if (isMedia || !isAllowedUrl(request.url())) void request.abort('blockedbyclient');
      else void request.continue();
    });
    return new FftaBrowser(browser, page);
  }

  /** The page's HTML once Cloudflare lets it through; throws `CloudflareBlockedError` when it does not. */
  async html(url: string): Promise<string> {
    const wait = this.#lastRequestAt + PAUSE_BETWEEN_PAGES_MS - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    this.#lastRequestAt = Date.now();

    await this.#page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    const passed = await this.#page
      // A string, run in the page: the server code has no DOM types.
      .waitForFunction(`!document.title.includes(${JSON.stringify(CLOUDFLARE_TITLE)})`, { timeout: PAGE_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!passed) throw new CloudflareBlockedError(url);
    return this.#page.content();
  }

  async close(): Promise<void> {
    await this.#browser.close();
  }
}
