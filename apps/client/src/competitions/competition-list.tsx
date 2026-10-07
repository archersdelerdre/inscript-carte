import type { CompetitionDto } from '@inscript-carte/shared';

import { CompetitionCard } from './competition-card';

/** Rendering every card of all of France makes the page slow and too long to scroll. */
const MAX_CARDS_FOR_ALL_FRANCE = 150;

type Props = {
  competitions: CompetitionDto[];
  allFrance: boolean;
  onShowOnMap: (competitionId: string) => void;
};

export function CompetitionList({ competitions, allFrance, onShowOnMap }: Props) {
  if (competitions.length === 0) {
    return <p className='text-muted-foreground'>Aucun concours à venir pour ce choix.</p>;
  }

  const shown = allFrance ? competitions.slice(0, MAX_CARDS_FOR_ALL_FRANCE) : competitions;
  const hiddenCount = competitions.length - shown.length;

  return (
    <ul className='flex flex-col gap-3'>
      {shown.map((competition) => (
        <li key={competition.id}>
          <CompetitionCard competition={competition} onShowOnMap={() => onShowOnMap(competition.id)} />
        </li>
      ))}
      {hiddenCount > 0 && (
        <li className='text-muted-foreground'>
          … et {hiddenCount} autres concours : choisissez un département pour les voir.
        </li>
      )}
    </ul>
  );
}
