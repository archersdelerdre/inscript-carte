import {
  apiPath,
  API_ROUTES,
  BOW_TYPE_LABELS,
  canChangeStatus,
  categoryLabel,
  DISTANCE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_STATUSES,
  type AdminCompetitionRegistrationsResponse,
  type AdminRegistrationDto,
  type PaymentStatus,
  type RegistrationStatus,
  type UpdatePaymentReferenceRequest,
  type UpdateRegistrationRequest,
} from '@inscript-carte/shared';
import { DownloadIcon, PencilIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, type ApiResult } from '@/lib/api';
import { formatDateRange, formatDateTime, formatDay } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';
import { StatusBadge } from '@/registrations/status-badge';

const ALL = 'all';
const MAX_CLUB_NOTE_LENGTH = 500;

type Props = { competitionId: string; onSessionExpired: () => void; onChanged: () => void };

/** A change waiting for the admin to confirm it: cancelling cannot be undone. */
type PendingCancel = { label: string; apply: () => Promise<void> };

/** One competition: its registrations grouped by payment reference (one archer's request), with every action. */
export function CompetitionRegistrations({ competitionId, onSessionExpired, onChanged }: Props) {
  const [data, setData] = useState<AdminCompetitionRegistrationsResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<typeof ALL | RegistrationStatus>(ALL);
  const [toPayOnly, setToPayOnly] = useState(false);
  const [noteFor, setNoteFor] = useState<AdminRegistrationDto | null>(null);
  const [pendingCancel, setPendingCancel] = useState<PendingCancel | null>(null);

  const showResult = useCallback(
    (result: ApiResult<AdminCompetitionRegistrationsResponse>) => {
      if (result.ok) return setData(result.data);
      if (result.error === 'admin_sign_in_required') return onSessionExpired();
      setMessage(ERROR_MESSAGES[result.error]);
    },
    [onSessionExpired],
  );
  const reload = useCallback(
    () =>
      api<AdminCompetitionRegistrationsResponse>(
        apiPath(API_ROUTES.adminCompetitionRegistrations, { competitionId }),
      ).then(showResult),
    [competitionId, showResult],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Every change reloads the rows (and the counts on the left), or explains why it was refused. */
  async function afterChange(result: ApiResult<unknown>) {
    if (!result.ok && result.error === 'admin_sign_in_required') return onSessionExpired();
    await reload();
    setMessage(result.ok ? null : ERROR_MESSAGES[result.error]);
    onChanged();
  }

  const updateRow = (registration: AdminRegistrationDto, body: UpdateRegistrationRequest) =>
    api(apiPath(API_ROUTES.adminRegistration, { registrationId: registration.id }), { method: 'PATCH', body }).then(
      afterChange,
    );
  const updateReference = (paymentReference: string, body: UpdatePaymentReferenceRequest) =>
    api(apiPath(API_ROUTES.adminPaymentReference, { paymentReference }), { method: 'PATCH', body }).then(afterChange);

  function changeRowStatus(registration: AdminRegistrationDto, status: RegistrationStatus) {
    const apply = () => updateRow(registration, { status });
    if (status !== 'cancelled') return void apply();
    setPendingCancel({ label: `le départ ${registration.departure} de ${registration.fullName}`, apply });
  }

  function changeReferenceStatus(group: Group, status: RegistrationStatus) {
    const apply = () => updateReference(group.paymentReference, { status });
    if (status !== 'cancelled') return void apply();
    setPendingCancel({ label: `tous les départs de ${group.fullName} (${group.paymentReference})`, apply });
  }

  async function download() {
    const response = await fetch(apiPath(API_ROUTES.adminCompetitionExport, { competitionId })).catch(() => null);
    if (response?.status === 401) return onSessionExpired();
    if (!response?.ok) return setMessage(ERROR_MESSAGES.network);
    const name =
      /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'inscriptions.xlsx';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = name;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (!data) {
    return message ? (
      <p role='alert' className='m-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
        {message}
      </p>
    ) : (
      <p className='text-muted-foreground p-4'>Chargement…</p>
    );
  }

  const { competition, registrations } = data;
  const shown = registrations.filter(
    (registration) =>
      (statusFilter === ALL || registration.status === statusFilter) &&
      (!toPayOnly || (registration.paymentStatus === 'to_pay' && registration.status !== 'cancelled')),
  );
  const groups = groupByReference(shown, registrations);
  const sendable = registrations.filter((registration) =>
    (['received', 'sent_to_organizer', 'confirmed'] as RegistrationStatus[]).includes(registration.status),
  ).length;

  return (
    <div className='grid gap-4 p-4'>
      <header className='grid gap-1'>
        <h1 className='text-xl leading-snug font-semibold tracking-tight'>{competition.title}</h1>
        <p className='text-muted-foreground'>
          {formatDateRange(competition.startDate, competition.endDate)} · {competition.town} (
          {competition.departmentCode}) · fin des inscriptions au club le{' '}
          {formatDay(competition.clubRegistrationDeadline)}
        </p>
        {competition.isCancelled && (
          <p className='w-fit rounded-md bg-red-50 px-3 py-2 text-sm text-red-900'>
            Ce concours a été annulé par l'organisateur.
          </p>
        )}
      </header>

      <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
        <Button variant='outline' onClick={() => void download()} disabled={sendable === 0}>
          <DownloadIcon />
          Fichier Excel pour l'organisateur
        </Button>
        <span className='text-muted-foreground text-sm'>
          {sendable} {sendable > 1 ? 'départs' : 'départ'} (statuts Reçue, Transmise, Validée)
        </span>
      </div>

      <div className='flex flex-wrap items-center gap-4'>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
          <SelectTrigger aria-label='Statut' className='min-w-56'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les statuts</SelectItem>
            {REGISTRATION_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {REGISTRATION_STATUS_LABELS[status]} ({competition.statusCounts[status]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className='flex items-center gap-2'>
          <Checkbox
            id='to-pay-only'
            checked={toPayOnly}
            onCheckedChange={(checked) => setToPayOnly(checked === true)}
          />
          <Label htmlFor='to-pay-only'>À payer seulement ({competition.toPayCount})</Label>
        </div>
      </div>

      {message && (
        <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
          {message}
        </p>
      )}
      {groups.length === 0 && <p className='text-muted-foreground'>Aucune inscription avec ces filtres.</p>}

      <ul className='grid gap-3'>
        {groups.map((group) => (
          <li key={group.paymentReference}>
            <ReferenceCard
              group={group}
              onRowStatus={changeRowStatus}
              onRowPayment={(registration, paymentStatus) => void updateRow(registration, { paymentStatus })}
              onRowNote={setNoteFor}
              onReferenceStatus={(status) => changeReferenceStatus(group, status)}
              onReferencePayment={(paymentStatus) => void updateReference(group.paymentReference, { paymentStatus })}
            />
          </li>
        ))}
      </ul>

      {noteFor && (
        <NoteDialog
          registration={noteFor}
          onClose={() => setNoteFor(null)}
          onSave={async (clubNote) => {
            setNoteFor(null);
            await updateRow(noteFor, { clubNote });
          }}
        />
      )}

      <AlertDialog open={pendingCancel !== null} onOpenChange={(open) => !open && setPendingCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Annuler {pendingCancel?.label} ?</AlertDialogTitle>
            <AlertDialogDescription>
              Une inscription annulée ne peut plus être réactivée : l'archer devra se réinscrire. La date d'annulation
              est ajoutée à la note du club.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Non, garder</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void pendingCancel?.apply();
                setPendingCancel(null);
              }}
            >
              Oui, annuler
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type Group = {
  paymentReference: string;
  fullName: string;
  /** The rows that match the filters. */
  rows: AdminRegistrationDto[];
  /** Every row of the reference that is not cancelled, shown or not: the reference actions change all of them. */
  activeRows: AdminRegistrationDto[];
};

/** Grouped by hand: `Map.groupBy` is missing from browsers older than 2024. Rows come sorted by reference. */
function groupByReference(shown: AdminRegistrationDto[], all: AdminRegistrationDto[]): Group[] {
  const groups = new Map<string, Group>();
  for (const registration of shown) {
    const group = groups.get(registration.paymentReference);
    if (group) group.rows.push(registration);
    else
      groups.set(registration.paymentReference, {
        paymentReference: registration.paymentReference,
        fullName: registration.fullName,
        rows: [registration],
        activeRows: all.filter(
          (row) => row.paymentReference === registration.paymentReference && row.status !== 'cancelled',
        ),
      });
  }
  return [...groups.values()];
}

type ReferenceCardProps = {
  group: Group;
  onRowStatus: (registration: AdminRegistrationDto, status: RegistrationStatus) => void;
  onRowPayment: (registration: AdminRegistrationDto, paymentStatus: PaymentStatus) => void;
  onRowNote: (registration: AdminRegistrationDto) => void;
  onReferenceStatus: (status: RegistrationStatus) => void;
  onReferencePayment: (paymentStatus: PaymentStatus) => void;
};

function ReferenceCard({
  group,
  onRowStatus,
  onRowPayment,
  onRowNote,
  onReferenceStatus,
  onReferencePayment,
}: ReferenceCardProps) {
  const [first] = group.rows as [AdminRegistrationDto, ...AdminRegistrationDto[]];
  const allPaid = group.activeRows.length > 0 && group.activeRows.every((row) => row.paymentStatus === 'paid');
  // The reference actions are only worth showing when they change more than one départ.
  const showReferenceActions = group.activeRows.length > 1;
  const referenceStatuses = REGISTRATION_STATUSES.filter((status) =>
    group.activeRows.every((row) => canChangeStatus(row.status, status)),
  );

  return (
    <section className='bg-card grid gap-3 rounded-lg border p-3'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div className='grid gap-0.5'>
          <h3 className='leading-snug font-semibold'>{first.fullName}</h3>
          <p className='text-muted-foreground text-sm'>
            Licence {first.licenceNumber} · {categoryLabel(first.category, first.sex)}
            {first.contact && (
              <>
                {' · '}
                <span className='whitespace-nowrap'>{first.contact}</span>
              </>
            )}
          </p>
          <p className='text-muted-foreground text-sm'>
            Réf. <strong className='text-foreground'>{group.paymentReference}</strong>
            {first.paymentMethod && ` · ${PAYMENT_METHOD_LABELS[first.paymentMethod]}`} · demandé le{' '}
            <span className='whitespace-nowrap'>{formatDateTime(first.createdAt)}</span>
          </p>
        </div>
        {showReferenceActions && (
          <div className='flex flex-wrap gap-2'>
            <Select value='' onValueChange={(value) => onReferenceStatus(value as RegistrationStatus)}>
              <SelectTrigger aria-label={`Statut de tous les départs de ${group.paymentReference}`}>
                <SelectValue placeholder='Statut de tous les départs' />
              </SelectTrigger>
              <SelectContent>
                {referenceStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {REGISTRATION_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant='outline' onClick={() => onReferencePayment(allPaid ? 'to_pay' : 'paid')}>
              {allPaid ? 'Tout remettre à payer' : 'Tout marquer payé'}
            </Button>
          </div>
        )}
      </div>

      <ul className='grid gap-2'>
        {group.rows.map((registration) => (
          <li key={registration.id} className='grid gap-2 border-t pt-2'>
            <DepartureRow
              registration={registration}
              onStatus={(status) => onRowStatus(registration, status)}
              onPayment={(paymentStatus) => onRowPayment(registration, paymentStatus)}
              onNote={() => onRowNote(registration)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

type DepartureRowProps = {
  registration: AdminRegistrationDto;
  onStatus: (status: RegistrationStatus) => void;
  onPayment: (paymentStatus: PaymentStatus) => void;
  onNote: () => void;
};

function DepartureRow({ registration, onStatus, onPayment, onNote }: DepartureRowProps) {
  const cancelled = registration.status === 'cancelled';
  const details = [
    BOW_TYPE_LABELS[registration.bowType],
    registration.trispot && 'Trispot',
    registration.distance && `Distances ${DISTANCE_LABELS[registration.distance].toLowerCase()}`,
  ].filter(Boolean);

  return (
    <>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium'>Départ {registration.departure}</span>
        <span className='text-muted-foreground'>{details.join(' · ')}</span>
        {/* A cancelled départ that was paid still shows it: the club may have to pay it back. */}
        {(!cancelled || registration.paymentStatus === 'paid') && (
          <Badge
            className={
              registration.paymentStatus === 'paid' ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'
            }
          >
            {PAYMENT_STATUS_LABELS[registration.paymentStatus]}
          </Badge>
        )}
        {cancelled && <StatusBadge status='cancelled' />}
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        {!cancelled && (
          <>
            <Select value={registration.status} onValueChange={(value) => onStatus(value as RegistrationStatus)}>
              <SelectTrigger aria-label={`Statut du départ ${registration.departure}`} className='min-w-56'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGISTRATION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status} disabled={!canChangeStatus(registration.status, status)}>
                    {REGISTRATION_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant='outline'
              onClick={() => onPayment(registration.paymentStatus === 'paid' ? 'to_pay' : 'paid')}
            >
              {registration.paymentStatus === 'paid' ? 'Remettre à payer' : 'Marquer payé'}
            </Button>
          </>
        )}
        <Button variant='ghost' onClick={onNote}>
          <PencilIcon />
          {registration.clubNote ? 'Modifier la note' : 'Ajouter une note'}
        </Button>
      </div>

      {registration.clubNote && <p className='text-sm whitespace-pre-line'>{registration.clubNote}</p>}
      {registration.updatedByName && (
        <p className='text-muted-foreground text-sm'>Dernière modification : {registration.updatedByName}</p>
      )}
    </>
  );
}

type NoteDialogProps = {
  registration: AdminRegistrationDto;
  onClose: () => void;
  onSave: (clubNote: string | null) => Promise<void>;
};

/** The note is shown to the archer in "Mon suivi". */
function NoteDialog({ registration, onClose, onSave }: NoteDialogProps) {
  const [note, setNote] = useState(registration.clubNote ?? '');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className='grid gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            void onSave(note.trim() || null);
          }}
        >
          <DialogHeader>
            <DialogTitle>Note du club</DialogTitle>
            <DialogDescription>
              {registration.fullName}, départ {registration.departure}. L'archer voit cette note dans « Mon suivi ».
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='club-note'>Note</Label>
            <Input
              id='club-note'
              value={note}
              maxLength={MAX_CLUB_NOTE_LENGTH}
              onChange={(event) => setNote(event.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Fermer
            </Button>
            <Button type='submit'>Enregistrer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
