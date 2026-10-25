import {
  apiPath,
  API_ROUTES,
  BOW_TYPE_LABELS,
  categoryLabel,
  departureTitle,
  type CompetitionDto,
  type CompetitionRegistrantDto,
  type ListCompetitionRegistrantsResponse,
} from '@inscript-carte/shared';
import { CarIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useSession } from '@/auth/session';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { formatDateRange } from '@/lib/dates';

import { departureDate, departureOptions } from './departures';
import { departuresPhrase, ERROR_MESSAGES } from './messages';

const dayHeading = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

type DayGroup = {
  /** `YYYY-MM-DD`, `null` for départs whose day is not known. */
  date: string | null;
  /** Each archer (and bow) with only their départs of that day. */
  registrants: CompetitionRegistrantDto[];
};

/** One group per day, in order; undated départs last. Asked by the user: who shoots together that day. */
function groupByDay(competition: CompetitionDto, registrants: CompetitionRegistrantDto[]): DayGroup[] {
  const groups = new Map<string | null, CompetitionRegistrantDto[]>();
  for (const registrant of registrants) {
    const byDate = new Map<string | null, number[]>();
    for (const departure of registrant.departures) {
      const date = departureDate(competition, departure);
      byDate.set(date, [...(byDate.get(date) ?? []), departure]);
    }
    for (const [date, departures] of byDate) {
      groups.set(date, [...(groups.get(date) ?? []), { ...registrant, departures }]);
    }
  }
  return [...groups]
    .map(([date, list]) => ({ date, registrants: list }))
    .toSorted((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
}

function dayLabel(date: string | null): string {
  if (!date) return 'Jour non précisé';
  const text = dayHeading.format(new Date(`${date}T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

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
          <div className='grid gap-4'>
            {groupByDay(competition, registrants).map((group) => (
              <section key={group.date ?? 'undated'} className='grid gap-2'>
                <h3 className='font-semibold'>{dayLabel(group.date)}</h3>
                <ul className='grid gap-2'>
                  {group.registrants.map((registrant) => (
                    <RegistrantItem
                      key={`${registrant.fullName}|${registrant.bowType}`}
                      competition={competition}
                      registrant={registrant}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RegistrantItem({
  competition,
  registrant,
}: {
  competition: CompetitionDto;
  registrant: CompetitionRegistrantDto;
}) {
  // The day is the group's heading: only the départ and its times here.
  const options = departureOptions(competition, { showDay: false });
  return (
    <li className='rounded-xl border px-4 py-3 shadow-sm'>
      <p className='flex flex-wrap items-center gap-2 font-medium'>
        {registrant.fullName}
        {registrant.carpool && (
          <Badge className='bg-sky-100 font-normal text-sky-900'>
            <CarIcon />
            Covoiturage
          </Badge>
        )}
      </p>
      <p className='text-muted-foreground text-sm'>
        {categoryLabel(registrant.category, registrant.sex)} · {BOW_TYPE_LABELS[registrant.bowType]}
        {!competition.departures && ` · ${departuresPhrase(registrant.departures)}`}
      </p>
      {competition.departures && (
        <ul className='text-muted-foreground text-sm'>
          {registrant.departures.map((number) => {
            const option = options[number - 1];
            return (
              <li key={number}>
                {[departureTitle(number, option?.name ?? null), option?.details].filter(Boolean).join(' · ')}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
