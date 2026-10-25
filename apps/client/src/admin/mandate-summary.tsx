import { AGE_CATEGORIES, categoriesLabel, type AdminCompetitionDto, type MandatePrice } from '@inscript-carte/shared';

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

/** What the scraper read in the mandate: the départs and the prices the Excel file uses. */
export function MandateSummary({ competition }: { competition: AdminCompetitionDto }) {
  const { departures, prices } = competition;
  if (!competition.mandateUrl) return null;
  if (!departures && !prices && !competition.rhythm) {
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
      <p className='font-medium'>{competition.rhythm ? `Rythme ${competition.rhythm}` : 'Rythme non précisé'}</p>
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
    </section>
  );
}
