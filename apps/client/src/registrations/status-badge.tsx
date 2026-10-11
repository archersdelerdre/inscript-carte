import { REGISTRATION_STATUS_LABELS, type PaymentStatus, type RegistrationStatus } from '@inscript-carte/shared';

import { Badge } from '@/components/ui/badge';

const STATUS_CLASSES: Record<RegistrationStatus, string> = {
  received: 'bg-secondary text-secondary-foreground',
  sent_to_organizer: 'bg-sky-100 text-sky-900',
  confirmed: 'bg-green-100 text-green-900',
  full: 'bg-red-100 text-red-900',
  cancelled: 'bg-transparent text-muted-foreground ring-1 ring-input',
};

export function StatusBadge({ status }: { status: RegistrationStatus }) {
  return <Badge className={STATUS_CLASSES[status]}>{REGISTRATION_STATUS_LABELS[status]}</Badge>;
}

/** Same hues as the badges, strong enough to read as a small dot. */
const DOT_CLASSES: Record<RegistrationStatus, string> = {
  received: 'bg-zinc-400',
  sent_to_organizer: 'bg-sky-500',
  confirmed: 'bg-green-600',
  full: 'bg-red-500',
  cancelled: 'bg-transparent ring-1 ring-inset ring-zinc-400',
};

/** For menus: the status color before its name. */
export function StatusDot({ status }: { status: RegistrationStatus }) {
  return <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${DOT_CLASSES[status]}`} />;
}

/** « Remboursé » is « À rembourser » done: the same violet, hollow. « Rien à payer » stays gray. */
const PAYMENT_DOT_CLASSES: Record<PaymentStatus, string> = {
  to_pay: 'bg-amber-500',
  paid: 'bg-green-600',
  nothing_due: 'bg-gray-400',
  to_refund: 'bg-violet-600',
  refunded: 'bg-transparent ring-2 ring-inset ring-violet-600',
};

/** For menus: the payment state's color before its name. */
export function PaymentDot({ paymentStatus }: { paymentStatus: PaymentStatus }) {
  return <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${PAYMENT_DOT_CLASSES[paymentStatus]}`} />;
}
