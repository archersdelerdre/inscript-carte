import type { AgeCategory } from './ffta-category.ts';
import { pricesFor, type MandatePrice } from './mandate.ts';
import type { PaymentStatus, RegistrationStatus } from './registration.ts';

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

/**
 * What one archer still has to pay the club for one competition: the price of every départ they pay for (to pay or
 * paid, not ended), less what the paid ones cost. With degressive prices, a 2nd départ added after paying the 1st
 * costs the difference ("1 départ 8 €, 2 départs 14 €": 6 €). `null` when nothing is left to pay, or when the
 * mandate gives no price that fits.
 */
export function amountDue(
  prices: readonly MandatePrice[] | null,
  category: AgeCategory,
  departures: readonly { status: RegistrationStatus; paymentStatus: PaymentStatus }[],
): number | null {
  const going = departures.filter(({ status }) => status !== 'full' && status !== 'cancelled');
  const toPay = going.filter(({ paymentStatus }) => paymentStatus === 'to_pay').length;
  if (toPay === 0) return null;
  const paid = going.filter(({ paymentStatus }) => paymentStatus === 'paid').length;
  const total = registrationPrice(prices, category, toPay + paid);
  const alreadyPaid = paid === 0 ? 0 : registrationPrice(prices, category, paid);
  if (total === null || alreadyPaid === null) return null;
  return Math.round((total - alreadyPaid) * 100) / 100;
}

/**
 * What the last of the départs whose money the club holds (paid, or to refund) is worth: their price, less the price
 * of one fewer. The amount a départ the club no longer counts on gives back as credit. With degressive prices, the
 * 2nd of "1 départ 9 €, 2 départs 16 €" is worth 7 €. `null` when the club holds no money for these départs, or when
 * the mandate gives no price that fits.
 */
export function heldDepartureValue(
  prices: readonly MandatePrice[] | null,
  category: AgeCategory,
  departures: readonly { paymentStatus: PaymentStatus }[],
): number | null {
  const held = departures.filter(({ paymentStatus }) => paymentStatus === 'paid' || paymentStatus === 'to_refund');
  if (held.length === 0) return null;
  const all = registrationPrice(prices, category, held.length);
  const others = held.length === 1 ? 0 : registrationPrice(prices, category, held.length - 1);
  if (all === null || others === null) return null;
  return Math.round((all - others) * 100) / 100;
}
