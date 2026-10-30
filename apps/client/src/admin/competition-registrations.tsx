import {
  apiPath,
  API_ROUTES,
  BOW_TYPE_LABELS,
  canChangePayment,
  canChangeStatus,
  categoryLabel,
  departureTitle,
  DISTANCE_LABELS,
  heldDepartureValue,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUSES,
  REGISTRATION_STATUS_LABELS,
  REGISTRATION_STATUSES,
  type AdminCompetitionRegistrationsResponse,
  type AdminRegistrationDto,
  type PaymentStatus,
  type RegistrationStatus,
  type UpdatePaymentReferenceRequest,
  type UpdateRegistrationRequest,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import {
  CarIcon,
  ChevronDownIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MessageSquareTextIcon,
  PencilIcon,
  SearchIcon,
} from 'lucide-react';
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
import { formatEuros } from '@/lib/euros';
import { matchesSearch } from '@/lib/search';
import { ERROR_MESSAGES } from '@/registrations/messages';
import { PaymentDot, StatusBadge, StatusDot } from '@/registrations/status-badge';

import { MandateSummary } from './mandate-summary';
import { RegistrationsSummary, type TileFilter } from './registrations-summary';

const ALL = 'all';
const MAX_CLUB_NOTE_LENGTH = 500;
/** What the organizer may receive, as on the server: not "Plus de place", not "Annulée". */
const SENT_STATUSES: readonly RegistrationStatus[] = ['received', 'sent_to_organizer', 'confirmed'];

type Props = { competitionId: string; onSessionExpired: () => void; onChanged: () => void };

/** The two status changes that need the admin to confirm: cancelling cannot be undone, "Reçue" reopens withdrawal. */
type ConfirmedStatus = 'cancelled' | 'received';
type PendingChange = { status: ConfirmedStatus; label: string; apply: () => Promise<void> };

const CONFIRMATIONS: Record<ConfirmedStatus, { title: (label: string) => string; text: string; button: string }> = {
  cancelled: {
    title: (label) => `Annuler ${label} ?`,
    text:
      "Une inscription annulée ne peut plus être réactivée : l'archer devra se réinscrire. La date d'annulation est " +
      'ajoutée à la note du club.',
    button: 'Oui, annuler',
  },
  received: {
    title: (label) => `Remettre ${label} à « Reçue » ?`,
    text:
      "L'archer pourra de nouveau retirer cette inscription lui-même depuis « Mon suivi », sans que l'organisateur " +
      "en soit informé. Si vous l'avez déjà transmise, prévenez-le.",
    button: 'Oui, remettre à « Reçue »',
  },
};

/** One competition: its registrations grouped by payment reference (one per archer), with every action. */
export function CompetitionRegistrations({ competitionId, onSessionExpired, onChanged }: Props) {
  const [data, setData] = useState<AdminCompetitionRegistrationsResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<typeof ALL | RegistrationStatus>(ALL);
  const [paymentFilter, setPaymentFilter] = useState<typeof ALL | PaymentStatus>(ALL);
  const [noteFor, setNoteFor] = useState<AdminRegistrationDto | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [toCredit, setToCredit] = useState<AdminRegistrationDto | null>(null);
  const [query, setQuery] = useState('');

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
    const needsConfirmation = status === 'cancelled' || (status === 'received' && registration.status !== 'received');
    if (!needsConfirmation) return void apply();
    setPendingChange({ status, label: `le départ ${registration.departure} de ${registration.fullName}`, apply });
  }

  function changeReferenceStatus(group: Group, status: RegistrationStatus) {
    const apply = () => updateReference(group.paymentReference, { status });
    const needsConfirmation =
      status === 'cancelled' || (status === 'received' && group.activeRows.some((row) => row.status !== 'received'));
    if (!needsConfirmation) return void apply();
    setPendingChange({
      status,
      label: `tous les départs de ${group.fullName} (${group.paymentReference})`,
      apply,
    });
  }

  async function download() {
    // The file follows the filters on screen: usually only the paid départs go to the organizer.
    const filters = new URLSearchParams();
    if (statusFilter !== ALL) filters.set('status', statusFilter);
    if (paymentFilter !== ALL) filters.set('paymentStatus', paymentFilter);
    const path = `${apiPath(API_ROUTES.adminCompetitionExport, { competitionId })}?${filters}`;
    const response = await fetch(path).catch(() => null);
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
      (paymentFilter === ALL || registration.paymentStatus === paymentFilter),
  );
  // The search only narrows what is shown: the Excel file follows the status and payment filters alone.
  const groups = groupByReference(shown, registrations).filter((group) =>
    matchesSearch(query, `${group.fullName} ${group.licenceNumber} ${group.paymentReference}`),
  );
  /** Same rule as the server: the shown départs the club still counts on. */
  const exported = shown.filter((registration) => SENT_STATUSES.includes(registration.status)).length;
  /** The same, for the whole competition: the heading and the tiles do not follow the filters. */
  const going = registrations.filter((registration) => SENT_STATUSES.includes(registration.status));
  const archerCount = new Set(going.map((registration) => registration.licenceNumber)).size;

  const isChosen = (filter: TileFilter) =>
    'status' in filter
      ? statusFilter === filter.status && paymentFilter === ALL
      : paymentFilter === filter.paymentStatus && statusFilter === ALL;
  /** A tile shows its départs alone; a second click shows everything again. */
  function chooseTile(filter: TileFilter) {
    const again = isChosen(filter);
    setStatusFilter(!again && 'status' in filter ? filter.status : ALL);
    setPaymentFilter(!again && 'paymentStatus' in filter ? filter.paymentStatus : ALL);
  }

  return (
    <div className='mx-auto grid max-w-6xl gap-8 p-4 md:p-8'>
      <header className='grid gap-2'>
        <div className='flex flex-wrap items-baseline gap-x-4 gap-y-1'>
          <h1 className='text-2xl leading-snug font-semibold tracking-tight'>{competition.title}</h1>
          {competition.mandateUrl && (
            <a
              href={competition.mandateUrl}
              target='_blank'
              rel='noopener'
              className='text-primary inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline'
            >
              <FileTextIcon className='size-4' />
              Mandat (PDF)
            </a>
          )}
          {competition.inscriptarcUrl && (
            <a
              href={competition.inscriptarcUrl}
              target='_blank'
              rel='noopener'
              className='text-primary inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline'
            >
              <ExternalLinkIcon className='size-4' />
              Inscriptions sur Inscript'Arc
            </a>
          )}
        </div>
        <p className='text-muted-foreground'>
          {formatDateRange(competition.startDate, competition.endDate)} · {competition.town} (
          {competition.departmentCode}) · inscription par le club jusqu'au{' '}
          <strong className='text-foreground font-semibold'>{formatDay(competition.clubRegistrationDeadline)}</strong>
        </p>
        {competition.isCancelled && (
          <p className='w-fit rounded-md bg-red-50 px-3 py-2 text-sm text-red-900'>
            Ce concours a été annulé par l'organisateur.
          </p>
        )}
      </header>

      <div className='grid gap-4'>
        <RegistrationsSummary competition={competition} going={going} isChosen={isChosen} onChoose={chooseTile} />
        <MandateSummary competition={competition} />
      </div>

      <section aria-labelledby='registrations-title' className='grid gap-4'>
        <h2 id='registrations-title' className='text-lg font-semibold'>
          Inscriptions{' '}
          <span className='text-muted-foreground font-normal'>
            · {going.length} {going.length > 1 ? 'départs en cours' : 'départ en cours'} pour {archerCount}{' '}
            {archerCount > 1 ? 'archers' : 'archer'}
          </span>
        </h2>
        {/* One toolbar for what narrows the list and for the file that follows the same filters. */}
        <div className='bg-card grid gap-3 rounded-xl border p-4 shadow-sm'>
          <div className='flex flex-wrap items-center gap-3'>
            <div className='relative min-w-52 flex-1 basis-52'>
              <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2' />
              <Input
                type='search'
                aria-label='Chercher un archer'
                placeholder='Nom, licence ou référence'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className='bg-background pl-10'
              />
            </div>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
              <SelectTrigger aria-label='Statut'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les statuts</SelectItem>
                {REGISTRATION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    <StatusDot status={status} />
                    {REGISTRATION_STATUS_LABELS[status]} ({competition.statusCounts[status]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={paymentFilter} onValueChange={(value) => setPaymentFilter(value as typeof paymentFilter)}>
              <SelectTrigger aria-label='Paiement'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les paiements</SelectItem>
                {PAYMENT_STATUSES.map((paymentStatus) => (
                  <SelectItem key={paymentStatus} value={paymentStatus}>
                    <PaymentDot paymentStatus={paymentStatus} />
                    {PAYMENT_STATUS_LABELS[paymentStatus]} (
                    {registrations.filter((registration) => registration.paymentStatus === paymentStatus).length})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant='outline' onClick={() => void download()} disabled={exported === 0}>
              <DownloadIcon />
              Fichier Excel pour l'organisateur
            </Button>
          </div>
          <p className='text-muted-foreground text-sm'>
            {exported === 0
              ? 'Aucun départ pour le fichier Excel avec ces filtres.'
              : `Le fichier Excel contiendra ${exported} ${exported > 1 ? 'départs' : 'départ'} : ceux affichés avec ces filtres, jamais « Plus de place » ni « Annulée ».`}
          </p>
        </div>

        {message && (
          <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
            {message}
          </p>
        )}
        {groups.length === 0 && (
          <p className='text-muted-foreground'>
            {query ? 'Aucun archer ne correspond à cette recherche.' : 'Aucune inscription avec ces filtres.'}
          </p>
        )}

        <ul className='grid gap-4'>
          {groups.map((group) => (
            <li key={group.paymentReference}>
              <ReferenceCard
                group={group}
                forceOpen={query.trim() !== ''}
                onRowStatus={changeRowStatus}
                onRowPayment={(registration, paymentStatus) =>
                  paymentStatus === 'credited'
                    ? setToCredit(registration)
                    : void updateRow(registration, { paymentStatus })
                }
                onRowNote={setNoteFor}
                onReferenceStatus={(status) => changeReferenceStatus(group, status)}
                onReferencePayment={(paymentStatus) => void updateReference(group.paymentReference, { paymentStatus })}
              />
            </li>
          ))}
        </ul>
      </section>

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

      {toCredit && (
        <CreditDialog
          registration={toCredit}
          suggested={heldDepartureValue(
            competition.prices,
            toCredit.category,
            registrations.filter((row) => row.paymentReference === toCredit.paymentReference),
          )}
          onClose={() => setToCredit(null)}
          onSave={async (credit) => {
            setToCredit(null);
            await updateRow(toCredit, { paymentStatus: 'credited', credit });
          }}
        />
      )}

      <AlertDialog open={pendingChange !== null} onOpenChange={(open) => !open && setPendingChange(null)}>
        {pendingChange && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{CONFIRMATIONS[pendingChange.status].title(pendingChange.label)}</AlertDialogTitle>
              <AlertDialogDescription>{CONFIRMATIONS[pendingChange.status].text}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Non, ne rien changer</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  void pendingChange.apply();
                  setPendingChange(null);
                }}
              >
                {CONFIRMATIONS[pendingChange.status].button}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}

type Group = {
  paymentReference: string;
  fullName: string;
  licenceNumber: string;
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
        licenceNumber: registration.licenceNumber,
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
  /** While searching, every card found is open. */
  forceOpen: boolean;
  onRowStatus: (registration: AdminRegistrationDto, status: RegistrationStatus) => void;
  onRowPayment: (registration: AdminRegistrationDto, paymentStatus: PaymentStatus) => void;
  onRowNote: (registration: AdminRegistrationDto) => void;
  onReferenceStatus: (status: RegistrationStatus) => void;
  onReferencePayment: (paymentStatus: PaymentStatus) => void;
};

function ReferenceCard({
  group,
  forceOpen,
  onRowStatus,
  onRowPayment,
  onRowNote,
  onReferenceStatus,
  onReferencePayment,
}: ReferenceCardProps) {
  const [first] = group.rows as [AdminRegistrationDto, ...AdminRegistrationDto[]];
  const paidCount = group.activeRows.filter((row) => row.paymentStatus === 'paid').length;
  const dueRows = group.activeRows.filter((row) => row.paymentStatus === 'to_pay');
  const allPaid = paidCount > 0 && dueRows.length === 0;
  // Cancelled départs included: their money too goes back to the archer.
  const toRefund = group.rows.filter((row) => row.paymentStatus === 'to_refund').length;
  // The reference actions are only worth showing when they change more than one départ.
  const showReferenceActions = group.activeRows.length > 1;
  const referenceStatuses = REGISTRATION_STATUSES.filter((status) =>
    group.activeRows.every((row) => canChangeStatus(row.status, status)),
  );
  // Each request of the reference may have chosen another way to pay.
  const paymentMethods = [
    ...new Set(group.rows.flatMap((row) => (row.paymentMethod ? [PAYMENT_METHOD_LABELS[row.paymentMethod]] : []))),
  ];
  // Nothing left to do for this archer: every départ is paid (or has nothing to pay) and answered by the organizer
  // (Validée or Plus de place), cancelled ones aside, and nothing is left to refund. Their card starts closed. It does
  // not close by itself after a change, so the admin keeps seeing what they just did.
  const finished =
    toRefund === 0 &&
    group.activeRows.every(
      (row) =>
        row.status === 'full' ||
        (row.status === 'confirmed' && (row.paymentStatus === 'paid' || row.paymentStatus === 'nothing_due')),
    );
  const [open, setOpen] = useState(!finished);
  const expanded = open || forceOpen;

  return (
    <section className='bg-card overflow-hidden rounded-xl border shadow-sm'>
      <header className={cn('flex flex-wrap items-center justify-between gap-3 px-5 py-4', expanded && 'border-b')}>
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
          className='flex min-w-0 flex-1 basis-72 items-start gap-2 text-left'
        >
          <ChevronDownIcon
            className={cn(
              'text-muted-foreground mt-0.5 size-5 shrink-0 transition-transform',
              !expanded && '-rotate-90',
            )}
          />
          <span className='grid min-w-0 gap-1'>
            <span className='flex flex-wrap items-center gap-x-2 gap-y-1'>
              <span className='text-lg leading-snug font-semibold'>{first.fullName}</span>
              <span className='text-muted-foreground text-sm'>{categoryLabel(first.category, first.sex)}</span>
              {allPaid && (
                <Badge className='bg-green-100 text-green-900'>
                  Tout est payé · {paidCount} {paidCount > 1 ? 'départs' : 'départ'}
                </Badge>
              )}
              {first.clubPaysRegistrations && <Badge className='bg-green-100 text-green-900'>Payé par le club</Badge>}
              {toRefund > 0 && (
                <Badge className='bg-violet-100 text-violet-900'>
                  {toRefund > 1 ? `${toRefund} départs à rembourser` : '1 départ à rembourser'}
                </Badge>
              )}
              {group.activeRows.some((row) => row.carpool) && (
                <Badge className='bg-sky-100 text-sky-900'>
                  <CarIcon />
                  Covoiturage
                </Badge>
              )}
            </span>
            <span className='text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm'>
              <span
                title='Référence de paiement'
                className='bg-background text-foreground rounded border px-1.5 font-mono text-sm font-semibold'
              >
                {group.paymentReference}
              </span>
              {paymentMethods.length > 0 && <span>{paymentMethods.join(', ')}</span>}
              <span aria-hidden>·</span>
              <span>licence {first.licenceNumber}</span>
              {first.contact && (
                <>
                  <span aria-hidden>·</span>
                  <span className='whitespace-nowrap'>{first.contact}</span>
                </>
              )}
              <span aria-hidden>·</span>
              <span className='whitespace-nowrap'>inscrit le {formatDateTime(first.createdAt)}</span>
            </span>
          </span>
        </button>
        {(showReferenceActions || toRefund > 1) && (
          <div className='flex flex-wrap gap-2'>
            {showReferenceActions && (
              <Select value='' onValueChange={(value) => onReferenceStatus(value as RegistrationStatus)}>
                <SelectTrigger
                  aria-label={`Statut de tous les départs de ${group.paymentReference}`}
                  className='bg-background'
                >
                  <SelectValue placeholder='Statut de tous les départs' />
                </SelectTrigger>
                <SelectContent>
                  {referenceStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      <StatusDot status={status} />
                      {REGISTRATION_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {showReferenceActions && (paidCount > 0 || dueRows.length > 0) && (
              <Button variant='outline' onClick={() => onReferencePayment(allPaid ? 'to_pay' : 'paid')}>
                {allPaid ? 'Tout remettre en attente de paiement' : 'Tout marquer comme payé'}
              </Button>
            )}
            {toRefund > 1 && (
              <Button variant='outline' onClick={() => onReferencePayment('refunded')}>
                Tout marquer comme remboursé
              </Button>
            )}
          </div>
        )}
      </header>

      {expanded && (
        <ul className='bg-muted/40 divide-y'>
          {group.rows.map((registration) => (
            <li key={registration.id} className='px-5 py-3'>
              <DepartureRow
                registration={registration}
                onStatus={(status) => onRowStatus(registration, status)}
                onPayment={(paymentStatus) => onRowPayment(registration, paymentStatus)}
                onNote={() => onRowNote(registration)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type DepartureRowProps = {
  registration: AdminRegistrationDto;
  onStatus: (status: RegistrationStatus) => void;
  onPayment: (paymentStatus: PaymentStatus) => void;
  onNote: () => void;
};

/**
 * One line per départ, in columns that line up from one row to the next: what, status, payment, note. The note and
 * the last admin who changed it go below, only when there is one.
 */
function DepartureRow({ registration, onStatus, onPayment, onNote }: DepartureRowProps) {
  const cancelled = registration.status === 'cancelled';
  const details = [
    BOW_TYPE_LABELS[registration.bowType],
    registration.trispot && 'Trispot',
    registration.distance && `Distances ${DISTANCE_LABELS[registration.distance].toLowerCase()}`,
  ].filter(Boolean);
  const noteLabel = registration.clubNote ? 'Modifier la note' : 'Ajouter une note';

  return (
    <div className={cn('grid gap-x-4 gap-y-1.5', cancelled && 'opacity-70')}>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-2 md:grid md:grid-cols-[minmax(9rem,1fr)_15rem_18rem_2.5rem]'>
        <p className='min-w-0'>
          <span className='font-semibold'>{departureTitle(registration.departure, registration.departureLabel)}</span>
          <span className='text-muted-foreground'> · {details.join(' · ')}</span>
        </p>

        {cancelled ? (
          <StatusBadge status='cancelled' />
        ) : (
          <Select value={registration.status} onValueChange={(value) => onStatus(value as RegistrationStatus)}>
            <SelectTrigger aria-label={`Statut du départ ${registration.departure}`} className='w-60 md:w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REGISTRATION_STATUSES.map((status) => (
                <SelectItem key={status} value={status} disabled={!canChangeStatus(registration.status, status)}>
                  <StatusDot status={status} />
                  {REGISTRATION_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Open on cancelled départs too: one paid then cancelled is refunded later. */}
        <Select value={registration.paymentStatus} onValueChange={(value) => onPayment(value as PaymentStatus)}>
          <SelectTrigger aria-label={`Paiement du départ ${registration.departure}`} className='w-60 md:w-full'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYMENT_STATUSES.map((paymentStatus) => (
              <SelectItem
                key={paymentStatus}
                value={paymentStatus}
                disabled={!canChangePayment(registration.paymentStatus, paymentStatus)}
              >
                <PaymentDot paymentStatus={paymentStatus} />
                {PAYMENT_STATUS_LABELS[paymentStatus]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant='ghost' size='icon' onClick={onNote} aria-label={noteLabel} title={noteLabel}>
          <PencilIcon />
        </Button>
      </div>

      {(registration.clubNote || registration.updatedByName || registration.credit !== null) && (
        <div className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm'>
          {registration.credit !== null && (
            <p className='text-foreground'>
              {formatEuros(registration.credit)} {registration.credit >= 2 ? 'gardés' : 'gardé'} en avoir
            </p>
          )}
          {registration.clubNote && (
            <p className='text-foreground flex gap-1.5 whitespace-pre-line'>
              <MessageSquareTextIcon className='text-muted-foreground mt-0.5 size-4 shrink-0' />
              {registration.clubNote}
            </p>
          )}
          {registration.updatedByName && <p>Modifié par {registration.updatedByName}</p>}
        </div>
      )}
    </div>
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
              Annuler
            </Button>
            <Button type='submit'>Enregistrer</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type CreditDialogProps = {
  registration: AdminRegistrationDto;
  /** What the départ is worth from the mandate's prices (`heldDepartureValue`); `null` when none fits. */
  suggested: number | null;
  onClose: () => void;
  onSave: (credit: number) => Promise<void>;
};

/** « Gardé en avoir »: the money of a départ to refund stays at the club, for the archer's next registrations. */
function CreditDialog({ registration, suggested, onClose, onSave }: CreditDialogProps) {
  const [amount, setAmount] = useState(suggested === null ? '' : String(suggested).replace('.', ','));
  const value = Number(amount.trim().replace(',', '.'));
  // Euros and cents, nothing smaller: 6,5 or 6,50 but not 6,505.
  const valid = amount.trim() !== '' && value > 0 && Math.abs(Math.round(value * 100) - value * 100) < 1e-6;
  const they = registration.sex === 'female' ? 'elle' : 'il';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className='grid gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void onSave(value);
          }}
        >
          <DialogHeader>
            <DialogTitle>Garder ce départ en avoir ?</DialogTitle>
            <DialogDescription>
              Au lieu de rembourser le départ {registration.departure} de {registration.fullName}, le club garde
              l'argent : {they} pourra s'en servir pour payer une prochaine inscription, depuis le formulaire.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='credit-amount'>Montant gardé en avoir, en euros</Label>
            <Input
              id='credit-amount'
              inputMode='decimal'
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className='w-32'
              autoFocus
            />
            <p className='text-muted-foreground text-sm'>
              {suggested === null
                ? "Le mandat ne donne pas de prix pour ce départ : indiquez la somme que l'archer a payée pour lui."
                : 'Calculé à partir des tarifs du mandat. Corrigez-le si l’archer a payé une autre somme.'}
            </p>
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Annuler
            </Button>
            <Button type='submit' disabled={!valid}>
              Garder en avoir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
