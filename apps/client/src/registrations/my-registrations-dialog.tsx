import {
  apiPath,
  API_ROUTES,
  BOW_TYPE_LABELS,
  departureTitle,
  isPaymentDue,
  type ListMyRegistrationsResponse,
  type MyRegistrationDto,
  type SignedInArcher,
} from '@inscript-carte/shared';
import { CarIcon, TargetIcon } from 'lucide-react';
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
import { formatDateRange, formatDay } from '@/lib/dates';

import { AddToCalendarButton } from './add-to-calendar-button';
import { competitionEvent } from './calendar';
import { ERROR_MESSAGES, PAYMENT_METHOD_PHRASES } from './messages';
import { StatusBadge } from './status-badge';

type Props = { archer: SignedInArcher; onClose: () => void; onWithdrawn: () => void };

/** "Mon suivi": the archer's own registrations, one line per départ. */
export function MyRegistrationsDialog({ archer, onClose, onWithdrawn }: Props) {
  const { signOut, sessionExpired } = useSession();
  const [registrations, setRegistrations] = useState<MyRegistrationDto[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [toWithdraw, setToWithdraw] = useState<MyRegistrationDto | null>(null);

  const showResult = useCallback(
    (result: ApiResult<ListMyRegistrationsResponse>) => {
      if (result.ok) return setRegistrations(result.data.registrations);
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
        {registrations === null && !message && <p className='text-muted-foreground'>Chargement…</p>}
        {registrations?.length === 0 && (
          <p className='text-muted-foreground'>
            Vous n'avez aucune inscription pour le moment. Choisissez un concours dans la liste, puis cliquez sur «
            S'inscrire ».
          </p>
        )}

        {[...byCompetition.values()].map((rows) => {
          const [first] = rows as [MyRegistrationDto, ...MyRegistrationDto[]];
          return (
            <section key={first.competitionId} className='grid gap-2 rounded-lg border p-3'>
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
                        {departureTitle(registration.departure, registration.departureLabel)}
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
                    {isPaymentDue(registration.status, registration.paymentStatus) && (
                      <p className='text-sm'>
                        En attente de paiement : à régler avant le {formatDay(registration.clubRegistrationDeadline)}
                        {registration.paymentMethod && `, ${PAYMENT_METHOD_PHRASES[registration.paymentMethod]}`},
                        référence <strong>{registration.paymentReference}</strong>
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
              <div>
                <AddToCalendarButton
                  uid={`${first.competitionId}-${first.paymentReference}@inscript-carte`}
                  event={competitionEvent({
                    title: first.competitionTitle,
                    town: first.town,
                    startDate: first.startDate,
                    endDate: first.endDate,
                    departures: rows.map((row) => departureTitle(row.departure, row.departureLabel)),
                  })}
                />
              </div>
            </section>
          );
        })}

        <p className='text-muted-foreground text-sm'>
          Pour ajouter un départ, cliquez sur « S'inscrire » sur la fiche du concours. Pour changer de départ, retirez
          l'ancien puis inscrivez-vous au nouveau. Une fois l'inscription transmise par le club, seul le club peut la
          modifier.
        </p>
      </DialogContent>

      <AlertDialog open={toWithdraw !== null} onOpenChange={(open) => !open && setToWithdraw(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer ce départ ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toWithdraw && departureTitle(toWithdraw.departure, toWithdraw.departureLabel)} du concours «{' '}
              {toWithdraw?.competitionTitle} ». Le club en sera informé.
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
