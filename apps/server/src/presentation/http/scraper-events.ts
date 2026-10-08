import type { ScraperStatusResponse } from '@inscript-carte/shared';

import type { ClientAddressSource } from './http.ts';

/** The run is written by another process: its row is read this often, only while someone watches. */
const POLL_EVERY_MS = 1000;
/** Proxies close a silent connection; a comment line keeps it open. */
const KEEP_ALIVE_EVERY_MS = 15_000;

const encoder = new TextEncoder();
const event = (status: ScraperStatusResponse) => encoder.encode(`data: ${JSON.stringify(status)}\n\n`);

/**
 * Server-sent events for the admin page: every open page gets the scraper status when it connects, then each time it
 * changes. One reading of the database serves all of them, and nothing runs while no page is open.
 */
export function createScraperEvents(readStatus: () => Promise<ScraperStatusResponse>) {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let last = '';
  let poll: Timer | undefined;
  let keepAlive: Timer | undefined;

  const send = (chunk: Uint8Array) => {
    for (const client of clients) {
      try {
        client.enqueue(chunk);
      } catch {
        // Closed in the meantime: `cancel` removes it.
      }
    }
  };

  async function check() {
    const status = await readStatus();
    const json = JSON.stringify(status);
    if (json === last) return;
    last = json;
    send(event(status));
  }

  function remove(client: ReadableStreamDefaultController<Uint8Array>) {
    clients.delete(client);
    // Polling stops with the last page closed.
    if (clients.size > 0) return;
    clearInterval(poll);
    clearInterval(keepAlive);
    poll = keepAlive = undefined;
    last = '';
  }

  return async function respond(request: Request, server: ClientAddressSource): Promise<Response> {
    // Bun closes a connection idle for 10 s by default: this one stays open as long as the page.
    server.timeout(request, 0);
    const first = await readStatus();
    let client: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        client = controller;
        // The first page sets what "changed" means; later pages just get the status they missed.
        if (clients.size === 0) last = JSON.stringify(first);
        clients.add(controller);
        controller.enqueue(event(first));
        poll ??= setInterval(() => void check(), POLL_EVERY_MS);
        keepAlive ??= setInterval(() => send(encoder.encode(': keep-alive\n\n')), KEEP_ALIVE_EVERY_MS);
      },
      cancel() {
        remove(client);
      },
    });
    request.signal.addEventListener('abort', () => remove(client));
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        // nginx and others buffer responses by default, which would hold the events back.
        'x-accel-buffering': 'no',
      },
    });
  };
}
