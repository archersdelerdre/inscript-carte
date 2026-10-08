import { API_ROUTES, type ScraperRunDto, type ScraperStatusResponse } from '@inscript-carte/shared';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';

/**
 * The FFTA scraper status, live: the server pushes it (server-sent events) as soon as it changes, to every admin
 * with the page open. `null` until the first event. `showRun` puts a run just started on screen without waiting for
 * the next event.
 */
export function useScraperStatus(onSessionExpired: () => void) {
  const [status, setStatus] = useState<ScraperStatusResponse | null>(null);

  useEffect(() => {
    const source = new EventSource(API_ROUTES.adminScraperEvents);
    source.addEventListener('message', (message: MessageEvent<string>) =>
      setStatus(JSON.parse(message.data) as ScraperStatusResponse),
    );
    // The browser reconnects by itself after a network cut; an expired session would make it retry forever.
    source.addEventListener('error', () => {
      void api<ScraperStatusResponse>(API_ROUTES.adminScraper).then((result) => {
        if (result.ok || result.error !== 'admin_sign_in_required') return;
        source.close();
        onSessionExpired();
      });
    });
    return () => source.close();
  }, [onSessionExpired]);

  const showRun = (run: ScraperRunDto) => setStatus((current) => current && { ...current, current: run });
  return { status, showRun };
}
