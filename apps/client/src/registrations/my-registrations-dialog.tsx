import {
  apiPath,
  API_ROUTES,
  BOW_TYPE_LABELS,
  CLUB_NAME,
  departureTitle,
  type ListMyRegistrationsResponse,
  type MyRegistrationDto,
  type SignedInArcher,
} from '@inscript-carte/shared';
import { CarIcon, CheckIcon, CopyIcon, TargetIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useSession } from '@/auth/session';
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, type ApiResult } from '@/lib/api';
import { formatDateRange, formatDay, todayInParis } from '@/lib/dates';
import { formatEuros } from '@/lib/euros';

import { AddToCalendarButton } from './add-to-calendar-button';
import { competitionEvents } from './calendar';
import { ERROR_MESSAGES, PAYMENT_METHOD_PHRASES } from './messages';
import { StatusBadge } from './status-badge';

type Props = { archer: SignedInArcher; onClose: () => void; onWithdrawn: () => void };

/** "Mon suivi": the archer's own registrations, one line per départ. */
export function MyRegistrationsDialog({ archer, onClose, onWithdrawn }: Props) {
  const { signOut, sessionExpired } = useSession();
  const [registrations, setRegistrations] = useState<MyRegistrationDto[] | null>(null);
  const [credit, setCredit] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [toWithdraw, setToWithdraw] = useState<MyRegistrationDto | null>(null);

  const showResult = useCallback(
    (result: ApiResult<ListMyRegistrationsResponse>) => {
      if (result.ok) {
        setCredit(result.data.credit);
        return setRegistrations(result.data.registrations);
      }
      if (result.error === 'not_signed_in') sessionExpired();
      setMessage(ERROR_MESSAGES[result.error]);
    },
    [sessionExpired],
  );

  useEffect(() => {
    void api<ListMyRegistrationsResponse>(API_ROUTES.myRegistrations).then(showResult);
  }, [showResult]);

  async function withdraw(registration: MyRegistrationDto) {
    const result = await api(apiPath(API_ROUTES.myRegistration, { registrationId: registration.id }), {
      method: 'DELETE',
    });
    setToWithdraw(null);
    if (!result.ok) return setMessage(ERROR_MESSAGES[result.error]);
    setMessage(null);
    onWithdrawn();
    showResult(await api<ListMyRegistrationsResponse>(API_ROUTES.myRegistrations));
  }

  const today = todayInParis();
  // Grouped by hand: `Map.groupBy` is missing from browsers older than 2024, still common on family tablets.
  const byCompetition = new Map<string, MyRegistrationDto[]>();
  for (const registration of registrations ?? []) {
    byCompetition.set(registration.competitionId, [
      ...(byCompetition.get(registration.competitionId) ?? []),
      registration,
    ]);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Mon suivi</DialogTitle>
          <DialogDescription>
            {archer.fullName} (licence {archer.licenceNumber}).{' '}
            <button
              type='button'
              className='text-foreground underline underline-offset-4'
              onClick={() => void signOut().then(onClose)}
            >
              Se déconnecter
            </button>
          </DialogDescription>
        </DialogHeader>

        {message && (
          <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
            {message}
          </p>
        )}
        {/* Only for the few archers who have one. */}
        {credit > 0 && (
          <p className='rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-950'>
            Vous avez un avoir de <strong>{formatEuros(credit)}</strong> au club. Pour l'utiliser, choisissez « Avec mon
            avoir » comme mode de paiement lors de votre prochaine inscription.
          </p>
        )}
        {registrations === null && !message && <p className='text-muted-foreground'>Chargement…</p>}
        {registrations?.length === 0 && (
          <p className='text-muted-foreground'>
            Vous n'avez aucune inscription pour le moment. Choisissez un concours dans la liste, puis cliquez sur «
            S'inscrire ».
          </p>
        )}

        {[...byCompetition.values()].map((rows) => {
          const [first] = rows as [MyRegistrationDto, ...MyRegistrationDto[]];
          const due = rows.find((row) => row.paymentStatus === 'to_pay');
          return (
            <section key={first.competitionId} className='grid gap-2 rounded-xl border p-4 shadow-sm'>
              {/* The chip goes after the title, or at the start of the next line when it does not fit. */}
              <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                <h3 className='leading-snug font-semibold'>
                  {first.competitionTitle}{' '}
                  <span className='text-muted-foreground font-normal'>
                    · {formatDateRange(first.startDate, first.endDate)}
                  </span>
                </h3>
                {/* Same rule as "Voir les inscrits": one départ with it is enough. */}
                {rows.some((row) => row.carpool) && (
                  <Badge className='bg-sky-100 font-normal text-sky-900'>
                    <CarIcon />
                    Covoiturage
                  </Badge>
                )}
              </div>
              <ul className='grid gap-3'>
                {rows.map((registration) => (
                  <li key={registration.id} className='grid gap-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium'>
                        {departureTitle(registration.departure, registration.mandateDeparture?.label ?? null)}
                      </span>
                      <StatusBadge status={registration.status} />
                      <span className='text-muted-foreground text-sm'>{BOW_TYPE_LABELS[registration.bowType]}</span>
                      {registration.trispot && (
                        <Badge className='bg-violet-100 font-normal text-violet-900'>
                          <TargetIcon />
                          Trispot
                        </Badge>
                      )}
                    </div>
                    {registration.paymentStatus === 'to_pay' && <p className='text-sm'>En attente de paiement.</p>}
                    {registration.paymentStatus === 'nothing_due' && registration.status !== 'full' && (
                      <p className='text-muted-foreground text-sm'>Rien à régler au club pour ce départ.</p>
                    )}
                    {registration.paymentStatus === 'to_refund' && (
                      <p className='text-sm'>Le club va vous rembourser ce départ.</p>
                    )}
                    {registration.paymentStatus === 'refunded' && (
                      <p className='text-muted-foreground text-sm'>Ce départ vous a été remboursé.</p>
                    )}
                    {registration.paymentStatus === 'credited' && (
                      <p className='text-muted-foreground text-sm'>
                        Le club garde ce paiement en avoir pour une prochaine inscription.
                      </p>
                    )}
                    {registration.clubNote && <p className='text-muted-foreground text-sm'>{registration.clubNote}</p>}
                    {registration.canWithdraw && (
                      <Button variant='outline' className='w-fit' onClick={() => setToWithdraw(registration)}>
                        Retirer ce départ
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {/* Once for the competition: the price is for all the archer's départs there. */}
              {due && (
                <p className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
                  À régler au club
                  {due.amountDue !== null && (
                    <>
                      {' '}
                      pour ce concours : <strong>{formatEuros(due.amountDue)}</strong>,
                    </>
                  )}{' '}
                  avant le {formatDay(due.clubRegistrationDeadline)}
                  {/* Paid with credit once, then to pay again: the credit is spent, so no method is told. */}
                  {due.paymentMethod &&
                    due.paymentMethod !== 'credit' &&
                    `, ${PAYMENT_METHOD_PHRASES[due.paymentMethod]}`}
                  , en indiquant la référence <strong className='whitespace-nowrap'>{due.paymentReference}</strong>.
                </p>
              )}
              {/* For the whole competition, set apart from the départs' own buttons. Not once it is over. */}
              {first.endDate >= today && (
                <div className='mt-2 border-t pt-3'>
                  <AddToCalendarButton
                    uid={`${first.competitionId}-${first.paymentReference}@inscript-carte`}
                    events={competitionEvents({
                      title: first.competitionTitle,
                      town: first.town,
                      startDate: first.startDate,
                      endDate: first.endDate,
                      departures: rows.map((row) => ({ number: row.departure, mandate: row.mandateDeparture })),
                    })}
                  />
                </div>
              )}
            </section>
          );
        })}

        <BankDetails />
      </DialogContent>

      <AlertDialog open={toWithdraw !== null} onOpenChange={(open) => !open && setToWithdraw(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer ce départ ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toWithdraw && departureTitle(toWithdraw.departure, toWithdraw.mandateDeparture?.label ?? null)} du
              concours « {toWithdraw?.competitionTitle} ». Le club en sera informé.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Non, le garder</AlertDialogCancel>
            <AlertDialogAction onClick={() => toWithdraw && void withdraw(toWithdraw)}>
              Oui, le retirer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/** The club's account, as in the member guide: shown to every member, whatever their way to pay. */
const CLUB_IBAN = 'FR76 1470 6000 3386 7675 9900 007';
const CLUB_BIC = 'AGRIFRPP847';

function BankDetails() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    // The bank apps want the IBAN without its spaces.
    await navigator.clipboard.writeText(CLUB_IBAN.replaceAll(' ', '')).catch(() => undefined);
    setCopied(true);
  }

  return (
    <section aria-labelledby='bank-details-title' className='bg-muted grid gap-2 rounded-xl p-4 text-sm'>
      <h3 id='bank-details-title' className='text-base font-semibold'>
        Paiement par virement
      </h3>
      <dl className='grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1'>
        <dt className='text-muted-foreground'>Titulaire</dt>
        <dd>{CLUB_NAME}</dd>
        <dt className='text-muted-foreground'>IBAN</dt>
        <dd className='flex flex-wrap items-center gap-x-2'>
          {/* Wraps between its groups of four on narrow phones: a single line made the dialog scroll sideways. */}
          <span className='font-mono select-all'>{CLUB_IBAN}</span>
          <Button variant='ghost' onClick={() => void copy()}>
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? 'Copié' : 'Copier'}
          </Button>
        </dd>
        <dt className='text-muted-foreground'>BIC</dt>
        <dd className='font-mono select-all'>{CLUB_BIC}</dd>
      </dl>
      <p>Indiquez la référence de l'inscription (R-…) dans le libellé du virement.</p>
    </section>
  );
}
