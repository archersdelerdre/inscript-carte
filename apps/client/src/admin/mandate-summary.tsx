import { AGE_CATEGORIES, categoriesLabel, type AdminCompetitionDto, type MandatePrice } from '@inscript-carte/shared';
import { ChevronRightIcon } from 'lucide-react';

import { departureOptions } from '@/registrations/departures';

/** One line per list of categories, the widest first ("Tous", "Jeunes", then "U11"): as the mandates write them. */
function priceGroups(prices: MandatePrice[]): { key: string; label: string; prices: MandatePrice[] }[] {
  // By hand: `Map.groupBy` is missing from older tablets.
  const groups = new Map<string, MandatePrice[]>();
  for (const price of prices) {
    const key = AGE_CATEGORIES.filter((category) => price.categories.includes(category)).join();
    groups.set(key, [...(groups.get(key) ?? []), price]);
  }
  return [...groups]
    .map(([key, list]) => ({ key, label: categoriesLabel(list[0]!.categories), prices: list }))
    .toSorted((a, b) => b.prices[0]!.categories.length - a.prices[0]!.categories.length);
}

const wholeEuros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** 9 → "9 €", 6.5 → "6,50 €". */
export function formatEuros(amount: number): string {
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

/** "Tarifs de 6 € à 20 €" for the summary line. */
function pricesOverview(prices: MandatePrice[] | null): string {
  if (!prices || prices.length === 0) return 'Pas de tarif lisible';
  const amounts = prices.map((price) => price.amountEuros);
  const [lowest, highest] = [Math.min(...amounts), Math.max(...amounts)];
  if (lowest === highest) return `Tarif ${formatEuros(lowest)}`;
  return `Tarifs de ${formatEuros(lowest)} à ${formatEuros(highest)}`;
}

/**
 * What the scraper read in the mandate: the départs and the prices the Excel file uses. Closed by default: a one-line
 * summary is enough most of the time, the details are one click away.
 */
export function MandateSummary({ competition }: { competition: AdminCompetitionDto }) {
  const { departures, prices } = competition;
  if (!competition.mandateUrl) return null;
  if (!departures && !prices && !competition.rhythm) {
    return (
      <p className='text-muted-foreground text-sm'>Le mandat n’a pas encore été lu : départs et tarifs inconnus.</p>
    );
  }
  const departureCount = departures?.length ?? 0;
  const overview = [
    competition.rhythm ? `Rythme ${competition.rhythm}` : 'Rythme non précisé',
    departures ? `${departureCount} ${departureCount > 1 ? 'départs' : 'départ'}` : 'Départs non précisés',
    pricesOverview(prices),
  ].join(' · ');

  return (
    <details className='group bg-card rounded-xl border shadow-sm'>
      <summary className='flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 [&::-webkit-details-marker]:hidden'>
        <ChevronRightIcon className='text-muted-foreground size-4.5 shrink-0 transition-transform group-open:rotate-90' />
        <span className='font-semibold'>Lu dans le mandat</span>
        <span className='text-muted-foreground text-sm'>{overview}</span>
      </summary>
      <div className='grid gap-x-10 gap-y-3 border-t px-4 py-3 md:grid-cols-[auto_auto] md:justify-start'>
        <div className='grid content-start gap-1'>
          <h3 className='font-medium'>Départs</h3>
          {departures ? (
            <ul className='text-muted-foreground grid gap-0.5 text-sm'>
              {departureOptions({ ...competition, departures }).map(({ number, name, details }) => (
                <li key={number}>
                  Départ {number} · <span className='text-foreground'>{name}</span>
                  {details && ` · ${details}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-muted-foreground text-sm'>Le mandat ne précise pas les départs.</p>
          )}
        </div>
        <div className='grid content-start gap-1'>
          <h3 className='font-medium'>Tarifs</h3>
          {prices ? (
            <ul className='grid gap-0.5 text-sm'>
              {priceGroups(prices).map(({ key, label, prices: own }) => (
                <li key={key}>
                  <span className='text-muted-foreground'>{label} :</span> {priceList(own)}
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-muted-foreground text-sm'>Le mandat ne donne pas de tarif lisible.</p>
          )}
        </div>
      </div>
    </details>
  );
}
