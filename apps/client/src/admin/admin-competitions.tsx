import { API_ROUTES, type AdminCompetitionDto, type ListAdminCompetitionsResponse } from '@inscript-carte/shared';
import { cn } from 'cn';
import { ArrowLeftIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { DISCIPLINE_COLORS } from '@/competitions/disciplines';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, type ApiResult } from '@/lib/api';
import { formatDateRange, splitDay } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';

import { CompetitionRegistrations } from './competition-registrations';

type Props = {
  /** From the address: `/admin/inscriptions/<id>`. `null` on the list alone. */
  selectedId: string | null;
  /** Changes the address; `null` goes back to the list. */
  onSelect: (competitionId: string | null) => void;
  onSessionExpired: () => void;
};

/** Competitions with club registrations on the left, the selected one on the right (one or the other on phones). */
export function AdminCompetitions({ selectedId, onSelect, onSessionExpired }: Props) {
  const [competitions, setCompetitions] = useState<AdminCompetitionDto[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
          'flex min-w-0 flex-col gap-4 overflow-y-auto p-4 max-md:flex-1 md:w-[360px] md:shrink-0 md:border-r 2xl:w-[420px]',
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
            onSelect={onSelect}
          />
        )}
        {finished.length > 0 && (
          <CompetitionGroup
            title='Concours terminés'
            competitions={finished}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        )}
      </aside>

      <main className={cn('bg-muted/50 min-w-0 flex-1 overflow-y-auto', selectedId === null && 'max-md:hidden')}>
        {selectedId === null ? (
          <p className='text-muted-foreground p-6'>Choisissez un concours dans la liste.</p>
        ) : (
          <>
            <Button variant='ghost' className='m-2 md:hidden' onClick={() => onSelect(null)}>
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
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'bg-card flex w-full gap-3 rounded-lg border p-3 text-left shadow-xs transition-shadow hover:shadow-md',
        selected && 'border-primary bg-primary/5 ring-primary ring-1',
      )}
    >
      {/* Date block in the discipline color, like the cards of the public list. */}
      <span
        className='flex w-12 shrink-0 flex-col items-center justify-center rounded-md py-1 leading-tight text-white'
        style={{ background: DISCIPLINE_COLORS[competition.discipline] }}
      >
        <span className='text-lg font-semibold'>{start.day}</span>
        <span className='text-sm'>{start.month}</span>
      </span>
      <span className='grid min-w-0 gap-1'>
        <span className='leading-snug font-medium'>{competition.title}</span>
        <span className='text-muted-foreground text-sm'>
          {formatDateRange(competition.startDate, competition.endDate)} · {competition.town} · {active}{' '}
          {active > 1 ? 'départs' : 'départ'}
        </span>
        {/* What is left to do, in the same colors as the badges of the detail. */}
        <span className='flex flex-wrap items-center gap-1.5'>
          {competition.isCancelled && <Badge className='bg-red-100 text-red-900'>Concours annulé</Badge>}
          {competition.isPostponed && <Badge className='bg-amber-100 text-amber-900'>Concours reporté</Badge>}
          {received > 0 && <Badge className='bg-sky-100 text-sky-900'>{received} à transmettre</Badge>}
          {competition.toPayCount > 0 && (
            <Badge className='bg-amber-100 text-amber-900'>{competition.toPayCount} en attente de paiement</Badge>
          )}
          {competition.toRefundCount > 0 && (
            <Badge className='bg-violet-100 text-violet-900'>{competition.toRefundCount} à rembourser</Badge>
          )}
        </span>
      </span>
    </button>
  );
}
