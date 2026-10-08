import type { AdminCompetitionDto, MandateAudience, MandatePrice } from '@inscript-carte/shared';

import { departureOptions } from '@/registrations/departures';

/** "Jeunes": every Uxx category, as in the Excel file's amounts. */
const AUDIENCES: { audience: MandateAudience; label: string }[] = [
  { audience: 'adult', label: 'Adultes' },
  { audience: 'youth', label: 'Jeunes (U11 à U21)' },
  { audience: 'all', label: 'Tous' },
];

const wholeEuros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** 9 → "9 €", 6.5 → "6,50 €". */
function formatEuros(amount: number): string {
  return (Number.isInteger(amount) ? wholeEuros : euros).format(amount);
}

function priceList(prices: MandatePrice[]): string {
  return prices
    .toSorted((a, b) => a.departures - b.departures)
    .map(
      ({ departures, amountEuros }) =>
        `${departures} ${departures > 1 ? 'départs' : 'départ'} ${formatEuros(amountEuros)}`,
    )
    .join(' · ');
}

/** What the scraper read in the mandate: the départs and the prices the Excel file uses. */
export function MandateSummary({ competition }: { competition: AdminCompetitionDto }) {
  const { departures, prices } = competition;
  if (!competition.mandateUrl) return null;
  if (!departures && !prices) {
    return (
      <p className='text-muted-foreground text-sm'>Le mandat n’a pas encore été lu : départs et tarifs inconnus.</p>
    );
  }
  const departureCount = departures?.length ?? 0;

  return (
    <section aria-labelledby='mandate-summary' className='bg-card grid w-fit gap-3 rounded-lg border px-4 py-3'>
      <h2 id='mandate-summary' className='font-semibold'>
        Lu dans le mandat
      </h2>
      <div className='grid gap-1'>
        <p className='font-medium'>
          {departures ? `${departureCount} ${departureCount > 1 ? 'départs' : 'départ'}` : 'Départs non précisés'}
        </p>
        {departures && (
          <ul className='text-muted-foreground grid gap-0.5 text-sm'>
            {departureOptions({ ...competition, departures }).map(({ number, name, details }) => (
              <li key={number}>
                Départ {number} · <span className='text-foreground'>{name}</span>
                {details && ` · ${details}`}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className='grid gap-1'>
        <p className='font-medium'>Tarifs</p>
        {prices ? (
          <ul className='grid gap-0.5 text-sm'>
            {AUDIENCES.map(({ audience, label }) => {
              const own = prices.filter((price) => price.audience === audience);
              return (
                own.length > 0 && (
                  <li key={audience}>
                    <span className='text-muted-foreground'>{label} :</span> {priceList(own)}
                  </li>
                )
              );
            })}
          </ul>
        ) : (
          <p className='text-muted-foreground text-sm'>Le mandat ne donne pas de tarif lisible.</p>
        )}
      </div>
    </section>
  );
}
