import { pricesFor, type AgeCategory, type MandatePrice } from '@inscript-carte/shared';

/**
 * What one archer pays for `departures` départs. The mandate's price for that number when it has one ("2 tirs
 * 16 €"); else the biggest offers that fit, added (3 départs with prices for 1 and 2: 2 + 1). Only the prices naming
 * the archer's category, the most specific first (`pricesFor`: a "U11" price beats a "Jeunes" one). `null` when the
 * mandate gives nothing that fits: never a guessed amount.
 */
export function registrationPrice(
  prices: readonly MandatePrice[] | null,
  category: AgeCategory,
  departures: number,
): number | null {
  if (!prices || departures < 1) return null;
  const offers = pricesFor(prices, category).toSorted((a, b) => b.departures - a.departures);
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
