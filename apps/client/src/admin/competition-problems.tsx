import {
  API_ROUTES,
  type CompetitionOverviewDto,
  type CompetitionProblem,
  type StartScraperRunResponse,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import { ExternalLinkIcon, FileTextIcon, RefreshCwIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';

function retrySentence(willRetry: boolean): string {
  return willRetry
    ? 'Elle sera tentée de nouveau lors de la prochaine mise à jour du calendrier.'
    : 'Elle ne sera plus tentée automatiquement : utilisez « Mettre à jour ce concours ».';
}

function problemText(problem: CompetitionProblem): string {
  switch (problem.kind) {
    case 'no_place':
      return 'Le lieu n’a pas été trouvé : le concours n’apparaît ni sur la carte ni dans la liste du public.';
    case 'missing':
      return `Le concours a disparu du calendrier de la FFTA le ${formatDay(problem.since)} : il est masqué au public.`;
    case 'mandate_unread':
      return 'Le mandat n’a pas encore été lu. Il le sera lors de la prochaine mise à jour du calendrier.';
    case 'mandate_failed':
      return `La lecture du mandat a échoué. ${retrySentence(problem.willRetry)}`;
    case 'mandate_refused':
      return `La lecture du mandat a été refusée par les contrôles : rien n’en est utilisé. ${retrySentence(problem.willRetry)}`;
    case 'mandate_without_departures':
      return 'Le mandat ne donne pas les départs : le formulaire d’inscription propose les départs 1 à 4.';
    case 'mandate_without_prices':
      return 'Le mandat ne donne pas de tarif lisible : le montant reste vide dans le fichier Excel.';
  }
}

type Props = {
  competition: CompetitionOverviewDto;
  scraperAvailable: boolean;
  onOpenRegistrations: (competitionId: string) => void;
  onOpenScraper: () => void;
  onSessionExpired: () => void;
};

/** What is wrong with a competition, and what an admin can do about it. */
export function ProblemsAndActions({
  competition,
  scraperAvailable,
  onOpenRegistrations,
  onOpenScraper,
  onSessionExpired,
}: Props) {
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<{ started: boolean; text: string } | null>(null);

  async function update() {
    setStarting(true);
    const response = await api<StartScraperRunResponse>(API_ROUTES.adminScraperRuns, {
      method: 'POST',
      body: { kind: 'competition', fftaId: competition.id },
    });
    setStarting(false);
    if (response.ok) {
      setResult({
        started: true,
        text: 'La mise à jour est lancée. Elle prend quelques secondes ; rechargez la page pour voir le résultat.',
      });
    } else if (response.error === 'admin_sign_in_required') {
      onSessionExpired();
    } else {
      setResult({ started: false, text: ERROR_MESSAGES[response.error] });
    }
  }

  const count = competition.clubArcherCount;
  return (
    <div className='grid gap-3'>
      {competition.problems.length === 0 ? (
        <p className='text-muted-foreground'>Aucun problème pour ce concours.</p>
      ) : (
        <ul className='grid gap-2'>
          {competition.problems.map((problem) => (
            <li key={problem.kind} className='grid gap-1'>
              <span>{problemText(problem)}</span>
              {'details' in problem && problem.details.length > 0 && (
                <ul className='text-muted-foreground grid gap-0.5 pl-4 text-sm'>
                  {problem.details.map((detail, index) => (
                    <li key={index} className='list-disc'>
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Button variant='outline' disabled={!scraperAvailable || starting} onClick={() => void update()}>
          <RefreshCwIcon className={cn(starting && 'animate-spin')} />
          Mettre à jour ce concours
        </Button>
        {count > 0 && (
          <Button variant='outline' onClick={() => onOpenRegistrations(competition.id)}>
            <UsersIcon />
            {`Voir les inscriptions (${count} ${count > 1 ? 'archers' : 'archer'})`}
          </Button>
        )}
        {competition.mandateUrl && (
          <Button variant='ghost' asChild>
            <a href={competition.mandateUrl} target='_blank' rel='noopener'>
              <FileTextIcon />
              Mandat (PDF)
            </a>
          </Button>
        )}
        <Button variant='ghost' asChild>
          <a href={`https://www.ffta.fr/epreuve/${competition.id}`} target='_blank' rel='noopener'>
            <ExternalLinkIcon />
            Fiche FFTA
          </a>
        </Button>
      </div>

      {!scraperAvailable && (
        <p className='text-muted-foreground text-sm'>
          Les mises à jour ne sont pas possibles sur ce serveur : aucun navigateur n’y est installé.
        </p>
      )}
      {result && (
        <p role='status' className={cn('text-sm', !result.started && 'text-amber-900')}>
          {result.text}{' '}
          {result.started && (
            <button type='button' className='text-primary underline' onClick={onOpenScraper}>
              Suivre la mise à jour
            </button>
          )}
        </p>
      )}
    </div>
  );
}
