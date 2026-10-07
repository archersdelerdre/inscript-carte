import { REGISTRATION_STATUS_LABELS, type RegistrationStatus } from '@inscript-carte/shared';

import { Badge } from '@/components/ui/badge';

const STATUS_CLASSES: Record<RegistrationStatus, string> = {
  received: 'bg-secondary text-secondary-foreground',
  awaiting_payment: 'bg-amber-100 text-amber-900',
  sent_to_organizer: 'bg-sky-100 text-sky-900',
  confirmed: 'bg-green-100 text-green-900',
  full: 'bg-red-100 text-red-900',
  cancelled: 'bg-transparent text-muted-foreground ring-1 ring-input',
};

export function StatusBadge({ status }: { status: RegistrationStatus }) {
  return <Badge className={STATUS_CLASSES[status]}>{REGISTRATION_STATUS_LABELS[status]}</Badge>;
}
