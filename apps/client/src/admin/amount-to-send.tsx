import {
  registrationPrice,
  type AdminCompetitionDto,
  type AdminRegistrationDto,
  type AgeCategory,
  type RegistrationStatus,
} from '@inscript-carte/shared';
import { BanknoteIcon } from 'lucide-react';

import { formatEuros } from './mandate-summary';

type Props = {
  competition: AdminCompetitionDto;
  registrations: readonly AdminRegistrationDto[];
  /** The départs the organizer may receive (not "Plus de place", not "Annulée"). */
  sentStatuses: readonly RegistrationStatus[];
};

/**
 * What the club owes the organizer: every archer's price for their paid départs, as in the Excel file, whatever the
 * filters on screen.
 */
export function AmountToSend({ competition, registrations, sentStatuses }: Props) {
  const paid = registrations.filter(
    (registration) => registration.paymentStatus === 'paid' && sentStatuses.includes(registration.status),
  );
  const archers = new Map<string, { category: AgeCategory; departures: number }>();
  for (const { licenceNumber, category } of paid) {
    const archer = archers.get(licenceNumber);
    if (archer) archer.departures += 1;
    else archers.set(licenceNumber, { category, departures: 1 });
  }
  let total = 0;
  let unpriced = 0;
  for (const { category, departures } of archers.values()) {
    const price = registrationPrice(competition.prices, category, departures);
    if (price === null) unpriced += 1;
    else total += price;
  }

  return (
    <section
      aria-labelledby='amount-to-send'
      className='bg-card flex w-fit items-start gap-3 rounded-lg border border-emerald-300 px-4 py-3 shadow-sm'
    >
      <span className='flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800'>
        <BanknoteIcon className='size-5' />
      </span>
      <div className='grid gap-0.5'>
        <h2 id='amount-to-send' className='text-muted-foreground text-sm'>
          À envoyer au club organisateur
        </h2>
        {competition.prices ? (
          <p className='text-2xl font-semibold text-emerald-800 tabular-nums'>
            {formatEuros(Math.round(total * 100) / 100)}
          </p>
        ) : (
          <p className='font-medium'>Montant inconnu</p>
        )}
        <p className='text-sm'>
          {paid.length === 0
            ? 'Aucun départ payé pour le moment.'
            : `${paid.length} ${paid.length > 1 ? 'départs payés' : 'départ payé'}, ${archers.size} ${archers.size > 1 ? 'archers' : 'archer'}`}
        </p>
        {!competition.prices && (
          <p className='text-muted-foreground max-w-xs text-sm'>Le mandat ne donne pas de tarif lisible.</p>
        )}
        {competition.prices && unpriced > 0 && (
          <p className='max-w-xs text-sm text-amber-900'>
            {unpriced > 1
              ? `Le mandat ne donne pas de tarif pour ${unpriced} archers : leurs départs ne sont pas comptés.`
              : 'Le mandat ne donne pas de tarif pour 1 archer : ses départs ne sont pas comptés.'}
          </p>
        )}
      </div>
    </section>
  );
}
