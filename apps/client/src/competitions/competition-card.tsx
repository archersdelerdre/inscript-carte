import { DISCIPLINE_LABELS, type CompetitionDto } from '@inscript-carte/shared';
import { ExternalLinkIcon, FileTextIcon, LocateFixedIcon, MapPinIcon, UsersIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDateRange, formatDay, splitDay, todayInParis } from '@/lib/dates';
import { useRegistrationActions } from '@/registrations/registration-actions';

import { DISCIPLINE_COLORS } from './disciplines';

type CardProps = {
  competition: CompetitionDto;
  onShowOnMap: () => void;
};

/** List card, laid out like a real-estate listing: a date block in the discipline color stands in for the photo. */
export function CompetitionCard({ competition, onShowOnMap }: CardProps) {
  const start = splitDay(competition.startDate);

  return (
    <Card className='flex-row gap-0 py-0 transition-shadow hover:shadow-md'>
      <div
        className='flex w-20 shrink-0 flex-col items-center justify-center gap-1 p-2 text-center text-white'
        style={{ backgroundColor: DISCIPLINE_COLORS[competition.discipline] }}
      >
        <span className='text-3xl leading-none font-semibold'>{start.day}</span>
        <span className='text-sm uppercase'>{start.month}</span>
        {competition.endDate !== competition.startDate && (
          <span className='text-sm'>au {formatDay(competition.endDate)}</span>
        )}
      </div>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5 p-3.5'>
        <Heading competition={competition} />
        <Place competition={competition} onShowOnMap={onShowOnMap} />
        <p className='text-muted-foreground'>
          {DISCIPLINE_LABELS[competition.discipline]}
          {competition.organizerClub && ` · ${competition.organizerClub}`}
        </p>
        <Deadline competition={competition} />
        <RegistrationCount competition={competition} />
        <div className='flex flex-wrap items-center gap-x-5 gap-y-2'>
          <Links competition={competition} />
        </div>
        <Actions competition={competition} />
      </div>
    </Card>
  );
}

/** Compact version for map popups, where the town is already the popup title. */
export function CompetitionPopupItem({ competition }: { competition: CompetitionDto }) {
  return (
    <div
      className='flex flex-col gap-1.5 border-l-4 py-0.5 pl-3'
      style={{ borderLeftColor: DISCIPLINE_COLORS[competition.discipline] }}
    >
      <Heading competition={competition} />
      <p>{formatDateRange(competition.startDate, competition.endDate)}</p>
      <p className='text-muted-foreground'>
        {DISCIPLINE_LABELS[competition.discipline]}
        {competition.organizerClub && ` · ${competition.organizerClub}`}
      </p>
      <Deadline competition={competition} />
      <RegistrationCount competition={competition} />
      <div className='flex flex-wrap gap-x-5'>
        <Links competition={competition} />
      </div>
      <Actions competition={competition} />
    </div>
  );
}

function Heading({ competition }: { competition: CompetitionDto }) {
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <h3 className='leading-snug font-semibold'>{competition.title}</h3>
      {competition.hasParaTir && <Badge className='bg-sky-100 text-sky-900'>Para-tir</Badge>}
      {competition.isPostponed && <Badge className='bg-amber-100 text-amber-900'>Reportée</Badge>}
    </div>
  );
}

function Place({ competition, onShowOnMap }: { competition: CompetitionDto; onShowOnMap: () => void }) {
  return (
    // Icon rows share one grid: 18 px icon + 8 px gap, so every text starts at the same place.
    <div className='flex min-w-0 items-center gap-2'>
      <MapPinIcon className='text-muted-foreground size-[1.125rem] shrink-0' />
      <span className='truncate'>{competition.town}</span>
      {competition.position ? (
        // Negative margins keep the 40 px tap target without making the line taller.
        <Button variant='link' className='-my-2 shrink-0 px-2' onClick={onShowOnMap}>
          <LocateFixedIcon />
          Voir sur la carte
        </Button>
      ) : (
        <span className='text-muted-foreground shrink-0 text-sm italic'>(lieu non précisé)</span>
      )}
    </div>
  );
}

function Deadline({ competition }: { competition: CompetitionDto }) {
  if (competition.clubRegistrationDeadline < todayInParis()) {
    return (
      <p className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
        Date limite du club dépassée. Il reste peut-être possible de s'inscrire directement auprès de l'organisateur.
      </p>
    );
  }
  return (
    <p className='text-muted-foreground text-sm'>
      Inscription par le club jusqu'au {formatDay(competition.clubRegistrationDeadline)}
    </p>
  );
}

function RegistrationCount({ competition }: { competition: CompetitionDto }) {
  // One archer on several départs counts once.
  const count = competition.clubArcherCount;
  return (
    <p className='flex items-center gap-2 text-sm'>
      <UsersIcon className='text-muted-foreground size-[1.125rem] shrink-0' />
      {count === 0
        ? 'Aucun archer du club inscrit pour le moment'
        : `${count} ${count > 1 ? 'archers inscrits' : 'archer inscrit'}`}
    </p>
  );
}

/** Bottom right of the card: the club registration actions. */
function Actions({ competition }: { competition: CompetitionDto }) {
  const { register, showRegistrants } = useRegistrationActions();
  const open = competition.clubRegistrationDeadline >= todayInParis();
  const hasRegistrants = competition.clubArcherCount > 0;
  // Nothing to see and nothing to do: no buttons at all.
  if (!open && !hasRegistrants) return null;
  return (
    // Equal widths across the text column: both edges line up with the lines above.
    <div className='mt-1 flex gap-2 *:flex-1'>
      {/* Kept but disabled (ghost) when nobody is registered: a hidden button left an odd empty space. */}
      <Button
        variant={hasRegistrants ? 'outline' : 'ghost'}
        disabled={!hasRegistrants}
        onClick={() => showRegistrants(competition)}
      >
        Voir les inscrits
      </Button>
      {open && <Button onClick={() => register(competition)}>S'inscrire</Button>}
    </div>
  );
}

function Links({ competition }: { competition: CompetitionDto }) {
  return (
    <>
      {competition.mandateUrl && (
        <Button variant='link' className='border-0 px-0' asChild>
          <a href={competition.mandateUrl} target='_blank' rel='noopener'>
            <FileTextIcon />
            Mandat (PDF)
          </a>
        </Button>
      )}
      <Button variant='link' className='text-muted-foreground border-0 px-0' asChild>
        <a href={`https://www.ffta.fr/epreuve/${competition.id}`} target='_blank' rel='noopener'>
          <ExternalLinkIcon />
          Détail FFTA
        </a>
      </Button>
    </>
  );
}
