const wholeEuros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** 9 → "9 €", 6.5 → "6,50 €". */
export function formatEuros(amount: number): string {
  return (Number.isInteger(amount) ? wholeEuros : euros).format(amount);
}
