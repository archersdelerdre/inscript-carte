import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MandateDocument, MandateFetcher } from '../../application/ports/mandates.ts';

/** The first pages hold the information; the rest is registration forms. */
const MAX_PAGES = 6;
/** Readable for an LLM (small prices, grids), still a few hundred KB per page. */
const RESOLUTION_DPI = 110;
const MAX_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const TOOL_TIMEOUT_MS = 60_000;

/** Mandates are on the FFTA's file server (`extranet.ffta.fr`): only `https` links to the FFTA are opened. */
export function isMandateUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return protocol === 'https:' && (host === 'ffta.fr' || host.endsWith('.ffta.fr'));
  } catch {
    return false;
  }
}

async function run(command: string[]): Promise<string> {
  const child = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe', timeout: TOOL_TIMEOUT_MS });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${command[0]} a échoué (code ${code}) : ${stderr.trim().split('\n')[0] ?? ''}`);
  return stdout;
}

/** Found when a mandate is read: without poppler only the mandates fail, never the whole run. */
function tool(name: 'pdfinfo' | 'pdftoppm' | 'pdftotext'): string {
  const path = Bun.which(name);
  if (!path) throw new Error(`${name} est introuvable : installez poppler (poppler-utils)`);
  return path;
}

/**
 * Downloads the PDF and turns it into JPEG pages with poppler's `pdftoppm`, plus its text with `pdftotext`
 * (`poppler-utils`, in the Docker image; `brew install poppler` on a Mac). The files live in a temporary folder
 * removed at once.
 */
export class PdfMandateFetcher implements MandateFetcher {
  async fetch(url: string): Promise<MandateDocument> {
    if (!isMandateUrl(url)) throw new Error('lien refusé (pas un fichier de la FFTA)');
    const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`le serveur de la FFTA répond ${response.status}`);
    if (!isMandateUrl(response.url)) throw new Error('redirigé hors de la FFTA');
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('fichier trop gros');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) throw new Error('fichier trop gros');
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('ce n’est pas un PDF');

    const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    const folder = await mkdtemp(join(tmpdir(), 'mandate-'));
    try {
      const pdf = join(folder, 'mandate.pdf');
      await Bun.write(pdf, bytes);
      const pageCount = Number(/^Pages:\s+(\d+)/m.exec(await run([tool('pdfinfo'), pdf]))?.[1] ?? 0);
      const pages = String(Math.min(Math.max(pageCount, 1), MAX_PAGES));
      const [text] = await Promise.all([
        run([tool('pdftotext'), '-layout', '-l', pages, pdf, '-']),
        run([
          tool('pdftoppm'),
          '-jpeg',
          '-jpegopt',
          'quality=80',
          '-r',
          String(RESOLUTION_DPI),
          '-l',
          pages,
          pdf,
          join(folder, 'page'),
        ]),
      ]);
      // pdftoppm pads the page numbers ("page-01.jpg"), so the name order is the page order.
      const images = (await readdir(folder)).filter((name) => name.endsWith('.jpg')).toSorted();
      if (images.length === 0) throw new Error('aucune page lisible');
      const pageImages = await Promise.all(
        images.map(async (name) => new Uint8Array(await Bun.file(join(folder, name)).arrayBuffer())),
      );
      return { sha256, pageCount, pageImages, text: text.trim() };
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }
}
