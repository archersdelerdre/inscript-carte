import { API_ROUTES, type AdminCompetitionDto, type ListAdminCompetitionsResponse } from '@inscript-carte/shared';
import { cn } from 'cn';
import { ArrowLeftIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, type ApiResult } from '@/lib/api';
import { formatDateRange, splitDay } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';

import { CompetitionRegistrations } from './competition-registrations';

type Props = { onSessionExpired: () => void };

/** Competitions with club registrations on the left, the selected one on the right (one or the other on phones). */
export function AdminCompetitions({ onSessionExpired }: Props) {
  const [competitions, setCompetitions] = useState<AdminCompetitionDto[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const showResult = useCallback(
    (result: ApiResult<ListAdminCompetitionsResponse>) => {
      if (result.ok) return setCompetitions(result.data.competitions);
      if (result.error === 'admin_sign_in_required') return onSessionExpired();
      setMessage(ERROR_MESSAGES[result.error]);
    },
    [onSessionExpired],
  );
  const reload = useCallback(
    () => void api<ListAdminCompetitionsResponse>(API_ROUTES.adminCompetitions).then(showResult),
    [showResult],
  );

  useEffect(reload, [reload]);

  const upcoming = competitions?.filter((competition) => !competition.isFinished) ?? [];
  const finished = competitions?.filter((competition) => competition.isFinished) ?? [];

  return (
    <div className='flex min-h-0 flex-1'>
      <aside
        className={cn(
          'bg-muted/30 flex min-w-0 flex-col gap-4 overflow-y-auto p-4 max-md:flex-1 md:w-[360px] md:shrink-0 md:border-r 2xl:w-[420px]',
          selectedId !== null && 'max-md:hidden',
        )}
      >
        {message && (
          <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
            {message}
          </p>
        )}
        {competitions === null && !message && <p className='text-muted-foreground'>Chargement…</p>}
        {competitions?.length === 0 && <p className='text-muted-foreground'>Aucune inscription pour le moment.</p>}
        {upcoming.length > 0 && (
          <CompetitionGroup
            title={`${upcoming.length} concours à venir`}
            competitions={upcoming}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
        {finished.length > 0 && (
          <CompetitionGroup
            title='Concours terminés'
            competitions={finished}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </aside>

      <main className={cn('min-w-0 flex-1 overflow-y-auto', selectedId === null && 'max-md:hidden')}>
        {selectedId === null ? (
          <p className='text-muted-foreground p-6'>Choisissez un concours dans la liste.</p>
        ) : (
          <>
            <Button variant='ghost' className='m-2 md:hidden' onClick={() => setSelectedId(null)}>
              <ArrowLeftIcon />
              Retour à la liste
            </Button>
            <CompetitionRegistrations
              key={selectedId}
              competitionId={selectedId}
              onSessionExpired={onSessionExpired}
              onChanged={reload}
            />
          </>
        )}
      </main>
    </div>
  );
}

type GroupProps = {
  title: string;
  competitions: AdminCompetitionDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function CompetitionGroup({ title, competitions, selectedId, onSelect }: GroupProps) {
  return (
    <section className='grid gap-2'>
      <h2 className='text-lg font-semibold tracking-tight'>{title}</h2>
      <ul className='grid gap-2'>
        {competitions.map((competition) => (
          <li key={competition.id}>
            <CompetitionItem
              competition={competition}
              selected={competition.id === selectedId}
              onSelect={() => onSelect(competition.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CompetitionItem({
  competition,
  selected,
  onSelect,
}: {
  competition: AdminCompetitionDto;
  selected: boolean;
  onSelect: () => void;
}) {
  const start = splitDay(competition.startDate);
  const { received, sent_to_organizer, confirmed, full } = competition.statusCounts;
  const active = received + sent_to_organizer + confirmed + full;
  const details = [
    `${active} ${active > 1 ? 'départs' : 'départ'}`,
    received > 0 && `${received} à transmettre`,
    competition.toPayCount > 0 && `${competition.toPayCount} en attente de paiement`,
  ].filter(Boolean);

  return (
    <button
      type='button'
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'bg-card flex w-full gap-3 rounded-lg border p-3 text-left transition-shadow hover:shadow-md',
        selected && 'border-primary ring-primary ring-1',
      )}
    >
      <span className='bg-muted flex w-12 shrink-0 flex-col items-center justify-center rounded-md py-1 leading-tight'>
        <span className='text-lg font-semibold'>{start.day}</span>
        <span className='text-sm'>{start.month}</span>
      </span>
      <span className='grid min-w-0 gap-1'>
        <span className='leading-snug font-medium'>{competition.title}</span>
        <span className='text-muted-foreground text-sm'>
          {formatDateRange(competition.startDate, competition.endDate)} · {competition.town}
        </span>
        <span className='flex flex-wrap items-center gap-1.5 text-sm'>
          {competition.isCancelled && <Badge className='bg-red-100 text-red-900'>Concours annulé</Badge>}
          {competition.isPostponed && <Badge className='bg-amber-100 text-amber-900'>Reportée</Badge>}
          {details.join(' · ')}
        </span>
      </span>
    </button>
  );
}
