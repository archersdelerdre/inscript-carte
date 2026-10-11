import type { AgeCategory, MandateAudience, MandatePrice } from '@inscript-carte/shared';

/**
 * Whose prices an archer pays, best first. The mandates' "jeunes" are every Uxx category, U21 included (the user's
 * rule, 2026-10-09); U11 have their own price in some mandates, else they are "jeunes". "Tous" last.
 */
function audiencesFor(category: AgeCategory): MandateAudience[] {
  if (category === 'U11') return ['u11', 'youth', 'all'];
  return category.startsWith('U') ? ['youth', 'all'] : ['adult', 'all'];
}

/**
 * What one archer pays for `departures` départs. The mandate's price for that number when it has one ("2 tirs
 * 16 €"); else the biggest offers that fit, added (3 départs with prices for 1 and 2: 2 + 1). The prices of the
 * archer's first audience that has some (`audiencesFor`). `null` when the mandate gives nothing that fits: never a
 * guessed amount.
 */
export function registrationPrice(
  prices: readonly MandatePrice[] | null,
  category: AgeCategory,
  departures: number,
): number | null {
  if (!prices || departures < 1) return null;
  const own =
    audiencesFor(category)
      .map((audience) => prices.filter((price) => price.audience === audience))
      .find((list) => list.length > 0) ?? [];
  const offers = own.toSorted((a, b) => b.departures - a.departures);
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
