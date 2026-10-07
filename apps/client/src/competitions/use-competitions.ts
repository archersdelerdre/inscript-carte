import { API_ROUTES, type CompetitionDto, type ListCompetitionsResponse } from '@inscript-carte/shared';
import { useCallback, useEffect, useState } from 'react';

export type CompetitionsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'loaded'; competitions: CompetitionDto[] };

/** The competitions, and `reload` to refresh them (registration counts change after a registration). */
export function useCompetitions(): [CompetitionsState, () => void] {
  const [state, setState] = useState<CompetitionsState>({ kind: 'loading' });

  const load = useCallback((signal?: AbortSignal) => {
    fetch(API_ROUTES.competitions, { signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<ListCompetitionsResponse>;
      })
      .then(({ competitions }) => setState({ kind: 'loaded', competitions }))
      .catch((error: unknown) => {
        if (signal?.aborted) return;
        console.error(error);
        // A failed refresh keeps the competitions already shown.
        setState((previous) => (previous.kind === 'loaded' ? previous : { kind: 'error' }));
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const reload = useCallback(() => load(), [load]);
  return [state, reload];
}
