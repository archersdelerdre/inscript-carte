import {
  API_ROUTES,
  type AdminCompetitionDto,
  type ListAdminCompetitionsResponse,
  type PaymentStatus,
  type RegistrationStatus,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import { ArrowLeftIcon, ListFilterIcon, ListIcon, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { DISCIPLINE_COLORS } from '@/competitions/disciplines';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, type ApiResult } from '@/lib/api';
import { formatDateRange, splitDay } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';
import { PaymentDot, StatusDot } from '@/registrations/status-badge';

import { CompetitionRegistrations } from './competition-registrations';

type ListFilter =
  | 'ongoing'
  | 'todo'
  | 'received'
  | 'sent_to_organizer'
  | 'confirmed'
  | 'full'
  | 'to_pay'
  | 'to_refund'
  | 'all';

type ListFilterOption = {
  value: ListFilter;
  label: string;
  keeps: (competition: AdminCompetitionDto) => boolean;
  /** The colors of the status and payment state it picks, as in the départ menus. */
  status?: RegistrationStatus;
  payment?: PaymentStatus;
  /** A general choice, no precise state: a neutral icon instead of the dots. */
  icon?: LucideIcon;
};

/** In the menu's order. "Concours" is masculine, "départ" too. */
const LIST_FILTERS: ListFilterOption[] = [
  // A competition whose départs were all cancelled has nothing left, unless the club still owes a refund.
  {
    value: 'ongoing',
    label: 'Avec des départs en cours',
    keeps: (c) => activeCount(c) > 0 || c.toRefundCount > 0,
    icon: ListFilterIcon,
  },
  {
    value: 'todo',
    label: 'Avec quelque chose à faire',
    keeps: (c) => c.statusCounts.received > 0 || c.toPayCount > 0 || c.toRefundCount > 0,
    status: 'received',
    payment: 'to_pay',
  },
  {
    value: 'received',
    label: 'Avec des départs à transmettre',
    keeps: (c) => c.statusCounts.received > 0,
    status: 'received',
  },
  {
    value: 'sent_to_organizer',
    label: 'Avec des départs transmis à l’organisateur',
    keeps: (c) => c.statusCounts.sent_to_organizer > 0,
    status: 'sent_to_organizer',
  },
  {
    value: 'confirmed',
    label: 'Avec des départs validés',
    keeps: (c) => c.statusCounts.confirmed > 0,
    status: 'confirmed',
  },
  { value: 'full', label: 'Avec des départs « Plus de place »', keeps: (c) => c.statusCounts.full > 0, status: 'full' },
  {
    value: 'to_pay',
    label: 'Avec des départs en attente de paiement',
    keeps: (c) => c.toPayCount > 0,
    payment: 'to_pay',
  },
  {
    value: 'to_refund',
    label: 'Avec des départs à rembourser',
    keeps: (c) => c.toRefundCount > 0,
    payment: 'to_refund',
  },
  { value: 'all', label: 'Tous, même sans départ en cours', keeps: () => true, icon: ListIcon },
];

/**
 * Two fixed slots, status then payment: in the open list an empty one keeps the labels aligned; in the closed menu
 * (the trigger repeats the chosen item) empty slots would only push the text, so they are hidden there. A general
 * choice (no precise state) shows a neutral icon in their place.
 */
function FilterDots({ status, payment, icon: Icon }: Pick<ListFilterOption, 'status' | 'payment' | 'icon'>) {
  if (Icon) {
    return (
      <span aria-hidden className='flex w-6 shrink-0 justify-center'>
        <Icon className='text-muted-foreground size-4' />
      </span>
    );
  }
  const empty = 'size-2.5 in-data-[slot=select-trigger]:hidden';
  return (
    <span aria-hidden className='flex shrink-0 gap-1'>
      {status ? <StatusDot status={status} /> : <span className={empty} />}
      {payment ? <PaymentDot paymentStatus={payment} /> : <span className={empty} />}
    </span>
  );
}

/** Départs not cancelled. */
function activeCount({ statusCounts }: AdminCompetitionDto): number {
  return statusCounts.received + statusCounts.sent_to_organizer + statusCounts.confirmed + statusCounts.full;
}

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
  const [filter, setFilter] = useState<ListFilter>('ongoing');

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

  const keeps = LIST_FILTERS.find(({ value }) => value === filter)!.keeps;
  const shown = competitions?.filter(keeps) ?? [];
  const upcoming = shown.filter((competition) => !competition.isFinished);
  const finished = shown.filter((competition) => competition.isFinished);

  return (
    <div className='flex min-h-0 flex-1'>
      <aside
        className={cn(
          'bg-muted/30 flex min-w-0 flex-col gap-4 overflow-y-auto p-4 max-md:flex-1 md:w-90 md:shrink-0 md:border-r 2xl:w-105',
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
        {competitions && competitions.length > 0 && (
          <Select value={filter} onValueChange={(value) => setFilter(value as ListFilter)}>
            <SelectTrigger aria-label='Concours affichés' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIST_FILTERS.map(({ value, label, status, payment, icon }) => (
                <SelectItem key={value} value={value}>
                  <FilterDots status={status} payment={payment} icon={icon} />
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {competitions && competitions.length > 0 && shown.length === 0 && (
          <p className='text-muted-foreground'>Aucun concours ne correspond à ce choix.</p>
        )}
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

      <main className={cn('bg-muted min-w-0 flex-1 overflow-y-auto', selectedId === null && 'max-md:hidden')}>
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
  const { received } = competition.statusCounts;
  const active = activeCount(competition);
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full gap-3 rounded-xl border p-3 text-left shadow-sm transition-shadow hover:shadow-md',
        selected ? 'border-primary ring-primary bg-red-50 ring-1' : 'bg-card',
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
