import { REGISTRATION_STATUS_LABELS, type RegistrationStatus } from '@inscript-carte/shared';

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
