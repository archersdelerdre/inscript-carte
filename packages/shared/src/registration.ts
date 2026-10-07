/** The one club whose members register through the app. */
export const CLUB_NAME = "Les Archers de l'Erdre";

export type Sex = 'female' | 'male';

export const BOW_TYPES = ['classique', 'poulies', 'arc_nu', 'chasse', 'longbow'] as const;
export type BowType = (typeof BOW_TYPES)[number];
export const BOW_TYPE_LABELS: Record<BowType, string> = {
  classique: 'Classique',
  poulies: 'Poulies',
  arc_nu: 'Arc nu',
  chasse: 'Arc de chasse',
  longbow: 'Longbow',
};

/** Asked only for "Extérieur" competitions. */
export const DISTANCES = ['nationales', 'internationales'] as const;
export type Distance = (typeof DISTANCES)[number];
export const DISTANCE_LABELS: Record<Distance, string> = {
  nationales: 'Nationales',
  internationales: 'Internationales',
};

export const REGISTRATION_STATUSES = ['received', 'sent_to_organizer', 'confirmed', 'full', 'cancelled'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export const REGISTRATION_STATUS_LABELS: Record<RegistrationStatus, string> = {
  received: 'Reçue',
  sent_to_organizer: "Transmise à l'organisateur",
  confirmed: 'Validée',
  full: 'Plus de place',
  cancelled: 'Annulée',
};

/**
 * What the club may change a départ to. A cancelled départ stays cancelled (the archer registers again instead), and
 * once sent to the organizer it never goes back to "Reçue", where the archer could still withdraw it.
 */
export function canChangeStatus(from: RegistrationStatus, to: RegistrationStatus): boolean {
  if (from === to) return true;
  return from !== 'cancelled' && to !== 'received';
}

export const PAYMENT_STATUSES = ['to_pay', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  to_pay: 'À payer',
  paid: 'Payé',
};

/** How the archer will pay the club; chosen when registering. */
export const PAYMENT_METHODS = ['cash', 'cheque', 'transfer'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  cheque: 'Chèque',
  transfer: 'Virement',
};

/** Départs are numbered from 1; the form offers 1 to this number. */
export const MAX_DEPARTURE = 6;
