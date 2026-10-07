import {
  apiPath,
  API_ROUTES,
  BOW_TYPE_LABELS,
  type CompetitionDto,
  type CompetitionRegistrantDto,
  type ListCompetitionRegistrantsResponse,
} from '@inscript-carte/shared';
import { useEffect, useState } from 'react';

import { useSession } from '@/auth/session';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatDateRange } from '@/lib/dates';

import { ERROR_MESSAGES } from './messages';

type Props = { competition: CompetitionDto; onClose: () => void };

/** Club members going to a competition (car-sharing, motivation). Names are only shown to members. */
export function RegistrantsDialog({ competition, onClose }: Props) {
  const { sessionExpired } = useSession();
  const [registrants, setRegistrants] = useState<CompetitionRegistrantDto[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void api<ListCompetitionRegistrantsResponse>(
      apiPath(API_ROUTES.competitionRegistrations, { competitionId: competition.id }),
    ).then((result) => {
      if (result.ok) return setRegistrants(result.data.registrants);
      if (result.error === 'not_signed_in') sessionExpired();
      setMessage(ERROR_MESSAGES[result.error]);
    });
  }, [competition.id, sessionExpired]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inscrits du club : {competition.title}</DialogTitle>
          <DialogDescription>
            {formatDateRange(competition.startDate, competition.endDate)}, {competition.town}
          </DialogDescription>
        </DialogHeader>
        {message && (
          <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
            {message}
          </p>
        )}
        {!message && registrants === null && <p className='text-muted-foreground'>Chargement…</p>}
        {registrants?.length === 0 && <p className='text-muted-foreground'>Aucun inscrit du club pour le moment.</p>}
        {registrants && registrants.length > 0 && (
          <ul className='grid gap-2'>
            {registrants.map((registrant) => (
              <li key={`${registrant.fullName}|${registrant.bowType}`} className='rounded-md border px-3 py-2'>
                <p className='font-medium'>{registrant.fullName}</p>
                <p className='text-muted-foreground text-sm'>
                  {BOW_TYPE_LABELS[registrant.bowType]} · départ{registrant.departures.length > 1 ? 's' : ''}{' '}
                  {registrant.departures.join(', ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
