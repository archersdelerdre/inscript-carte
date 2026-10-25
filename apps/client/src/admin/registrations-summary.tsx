import {
  registrationPrice,
  type AdminCompetitionDto,
  type AdminRegistrationDto,
  type AgeCategory,
  type PaymentStatus,
  type RegistrationStatus,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import { CheckIcon } from 'lucide-react';

import { formatEuros } from './mandate-summary';

/** A filter a task can set: a status or a payment state. */
export type TileFilter = { status: RegistrationStatus } | { paymentStatus: PaymentStatus };

type Props = {
  competition: AdminCompetitionDto;
  /** Every départ the organizer may receive (not "Plus de place", not "Annulée"), whatever the filters. */
  going: AdminRegistrationDto[];
  /** The task matching the filters on screen shows as chosen. */
  isChosen: (filter: TileFilter) => boolean;
  onChoose: (filter: TileFilter) => void;
};

/**
 * One bar with what is left to do, as chips in the colors of the list on the left (a click shows those départs only),
 * and the money to send to the organizer. Always for the whole competition, whatever the filters.
 */
export function RegistrationsSummary({ competition, going, isChosen, onChoose }: Props) {
  const tasks: { filter: TileFilter; text: string; count: number; color: string }[] = [
    {
      filter: { status: 'received' },
      text: 'à transmettre',
      count: competition.statusCounts.received,
      color: 'bg-sky-100 text-sky-900 hover:bg-sky-200',
    },
    {
      filter: { paymentStatus: 'to_pay' },
      text: 'en attente de paiement',
      count: competition.toPayCount,
      color: 'bg-amber-100 text-amber-900 hover:bg-amber-200',
    },
    {
      filter: { paymentStatus: 'to_refund' },
      text: 'à rembourser',
      count: competition.toRefundCount,
      color: 'bg-violet-100 text-violet-900 hover:bg-violet-200',
    },
  ];
  const due = tasks.filter(({ count }) => count > 0);

  return (
    <section
      aria-label='Résumé'
      className='bg-card flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-xl border px-5 py-4 shadow-sm'
    >
      <div className='flex flex-wrap items-center gap-2'>
        <span className='mr-1 font-medium'>À faire :</span>
        {due.length === 0 && <span className='text-muted-foreground'>il n'y a plus rien à faire.</span>}
        {due.map(({ filter, text, count, color }) => {
          const chosen = isChosen(filter);
          return (
            <button
              key={text}
              type='button'
              aria-pressed={chosen}
              onClick={() => onChoose(filter)}
              title={chosen ? 'Afficher tous les départs' : 'Afficher seulement ces départs'}
              className={cn(
                'inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm transition-colors',
                color,
                chosen && 'ring-foreground ring-2',
              )}
            >
              {chosen && <CheckIcon className='size-4' />}
              <strong className='font-semibold tabular-nums'>{count}</strong> {text}
            </button>
          );
        })}
      </div>
      <AmountToSend competition={competition} going={going} />
    </section>
  );
}

/**
 * The organizer's price for these départs: each archer's price for their départs among them, as in the Excel file.
 * Archers the mandate gives no price for are counted apart, never guessed.
 */
function amountFor(prices: AdminCompetitionDto['prices'], departures: readonly AdminRegistrationDto[]) {
  const archers = new Map<string, { category: AgeCategory; departures: number }>();
  for (const { licenceNumber, category } of departures) {
    const archer = archers.get(licenceNumber);
    if (archer) archer.departures += 1;
    else archers.set(licenceNumber, { category, departures: 1 });
  }
  let total = 0;
  let unpriced = 0;
  for (const { category, departures: count } of archers.values()) {
    const price = registrationPrice(prices, category, count);
    if (price === null) unpriced += 1;
    else total += price;
  }
  return { total: Math.round(total * 100) / 100, archerCount: archers.size, unpriced };
}

/**
 * What the club owes the organizer for the paid départs, and smaller, what it will owe once every départ in progress
 * is paid (asked by Loïc, 2026-10-25).
 */
function AmountToSend({ competition, going }: { competition: AdminCompetitionDto; going: AdminRegistrationDto[] }) {
  const paid = going.filter((registration) => registration.paymentStatus === 'paid');
  const now = amountFor(competition.prices, paid);
  const forecast = amountFor(competition.prices, going);

  return (
    <div className='flex items-center gap-4'>
      <div className='grid text-sm'>
        <span className='font-medium'>À envoyer au club organisateur</span>
        <span className='text-muted-foreground'>
          {paid.length === 0
            ? 'Aucun départ payé pour le moment.'
            : `${paid.length} ${paid.length > 1 ? 'départs payés' : 'départ payé'}, ${now.archerCount} ${now.archerCount > 1 ? 'archers' : 'archer'}`}
        </span>
        {competition.prices && going.length > paid.length && (
          <span className='text-muted-foreground'>
            Une fois tous les départs en cours payés :{' '}
            <strong className='text-foreground font-semibold whitespace-nowrap'>{formatEuros(forecast.total)}</strong>
          </span>
        )}
        {!competition.prices && <span className='text-muted-foreground'>Le mandat ne donne pas de tarif lisible.</span>}
        {competition.prices && forecast.unpriced > 0 && (
          <span className='text-amber-900'>
            {forecast.unpriced > 1
              ? `Le mandat ne donne pas de tarif pour ${forecast.unpriced} archers : leurs départs ne sont pas comptés.`
              : 'Le mandat ne donne pas de tarif pour 1 archer : ses départs ne sont pas comptés.'}
          </span>
        )}
      </div>
      <p className='rounded-lg bg-emerald-50 px-3 py-1.5 text-2xl font-semibold whitespace-nowrap text-emerald-900 tabular-nums'>
        {competition.prices ? formatEuros(now.total) : '? €'}
      </p>
    </div>
  );
}
