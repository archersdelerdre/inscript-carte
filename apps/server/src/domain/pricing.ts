import type { AgeCategory, MandateAudience, MandatePrice } from '@inscript-carte/shared';

/** The mandates' "jeunes": every Uxx category, U21 included (the user's rule, 2026-10-09). */
export function priceAudience(category: AgeCategory): Exclude<MandateAudience, 'all'> {
  return category.startsWith('U') ? 'youth' : 'adult';
}

/**
 * What one archer pays for `departures` départs. The mandate's price for that number when it has one ("2 tirs
 * 16 €"); else the biggest offers that fit, added (3 départs with prices for 1 and 2: 2 + 1). Prices for the
 * archer's audience first, else the ones for everyone. `null` when the mandate gives nothing that fits: never a
 * guessed amount.
 */
export function registrationPrice(
  prices: readonly MandatePrice[] | null,
  category: AgeCategory,
  departures: number,
): number | null {
  if (!prices || departures < 1) return null;
  const audience = priceAudience(category);
  const own = prices.filter((price) => price.audience === audience);
  const offers = (own.length > 0 ? own : prices.filter((price) => price.audience === 'all')).toSorted(
    (a, b) => b.departures - a.departures,
  );
  let left = departures;
  let total = 0;
  while (left > 0) {
    const offer = offers.find((price) => price.departures <= left);
    if (!offer) return null;
    total += offer.amountEuros;
    left -= offer.departures;
  }
  return Math.round(total * 100) / 100;
}
