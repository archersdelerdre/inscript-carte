import {
  API_ROUTES,
  DISCIPLINE_LABELS,
  type CompetitionOverviewDto,
  type CompetitionOverviewResponse,
  type CompetitionProblem,
  type ScraperStatusResponse,
  type StartScraperRunResponse,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import { ChevronRightIcon, ExternalLinkIcon, FileTextIcon, RefreshCwIcon, UsersIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ALL_FRANCE, inArea } from '@/competitions/areas';
import {
  CompetitionFilterBar,
  type CompetitionFilters,
  matchesFilters,
  NO_FILTERS,
} from '@/competitions/competition-filters';
import { townSuggestions } from '@/competitions/town-search';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';

type ProblemFilter = 'all' | 'problems' | 'hidden';

/** The table covers a year ahead: the year is needed. */
const fullDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function dateLabel({ startDate, endDate }: CompetitionOverviewDto): string {
  const end = fullDate.format(new Date(`${endDate}T00:00:00Z`));
  return startDate === endDate ? end : `${formatDay(startDate)} au ${end}`;
}

/** Shown in the table: a few words per problem. */
const SHORT_LABELS: Record<CompetitionProblem['kind'], string> = {
  no_place: 'Lieu introuvable',
  missing: 'Absent du calendrier FFTA',
  mandate_unread: 'Mandat pas encore lu',
  mandate_failed: 'Lecture du mandat échouée',
  mandate_refused: 'Lecture du mandat refusée',
  mandate_without_departures: 'Départs absents du mandat',
  mandate_without_prices: 'Tarifs absents du mandat',
};

/** Hidden from the public, or nothing read from the mandate: red. The rest (waiting, partial reading): amber. */
const SERIOUS: ReadonlySet<CompetitionProblem['kind']> = new Set([
  'no_place',
  'missing',
  'mandate_failed',
  'mandate_refused',
]);

function retrySentence(willRetry: boolean): string {
  return willRetry
    ? 'Elle sera tentée de nouveau lors de la prochaine mise à jour du calendrier.'
    : 'Elle ne sera plus tentée automatiquement : utilisez « Mettre à jour ce concours ».';
}

/** Shown when the row is opened. */
function problemText(problem: CompetitionProblem): string {
  switch (problem.kind) {
    case 'no_place':
      return 'Le lieu n’a pas été trouvé : le concours n’apparaît ni sur la carte ni dans la liste du public.';
    case 'missing':
      return `Le concours a disparu du calendrier de la FFTA le ${formatDay(problem.since)} : il est masqué au public.`;
    case 'mandate_unread':
      return 'Le mandat n’a pas encore été lu. Il le sera lors de la prochaine mise à jour du calendrier.';
    case 'mandate_failed':
      return `La lecture du mandat a échoué. ${retrySentence(problem.willRetry)}`;
    case 'mandate_refused':
      return `La lecture du mandat a été refusée par les contrôles : rien n’en est utilisé. ${retrySentence(problem.willRetry)}`;
    case 'mandate_without_departures':
      return 'Le mandat ne donne pas les départs : le formulaire d’inscription propose les départs 1 à 4.';
    case 'mandate_without_prices':
      return 'Le mandat ne donne pas de tarif lisible : le montant reste vide dans le fichier Excel.';
  }
}

function isHidden(competition: CompetitionOverviewDto): boolean {
  return competition.isCancelled || competition.problems.some(({ kind }) => kind === 'no_place' || kind === 'missing');
}

function stateLabel(competition: CompetitionOverviewDto): string {
  if (competition.isCancelled) return 'Annulé';
  return competition.isPostponed ? 'Reporté' : 'Prévu';
}

type Props = {
  onOpenRegistrations: (competitionId: string) => void;
  onOpenScraper: () => void;
  onSessionExpired: () => void;
};

/** Every upcoming competition, the ones the public does not see included, with what is wrong with each. */
export function CompetitionsPage({ onOpenRegistrations, onOpenScraper, onSessionExpired }: Props) {
  const [competitions, setCompetitions] = useState<CompetitionOverviewDto[] | null>(null);
  const [scraperAvailable, setScraperAvailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** The same filters as the public page, plus the problems. Not remembered: admins start from all of France. */
  const [area, setArea] = useState(ALL_FRANCE);
  const [filters, setFilters] = useState<CompetitionFilters>(NO_FILTERS);
  const [problemFilter, setProblemFilter] = useState<ProblemFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api<CompetitionOverviewResponse>(API_ROUTES.adminCompetitionOverview),
      api<ScraperStatusResponse>(API_ROUTES.adminScraper),
    ]).then(([list, scraper]) => {
      if (!list.ok) {
        if (list.error === 'admin_sign_in_required') onSessionExpired();
        else setMessage(ERROR_MESSAGES[list.error]);
        return;
      }
      setCompetitions(list.data.competitions);
      setScraperAvailable(scraper.ok && scraper.data.available);
    });
  }, [onSessionExpired]);

  const all = useMemo(() => competitions ?? [], [competitions]);
  const departmentCodes = useMemo(
    () => [...new Set(all.map((competition) => competition.departmentCode))].toSorted(),
    [all],
  );
  const inSelectedArea = useMemo(() => inArea(all, area), [all, area]);
  const towns = useMemo(() => townSuggestions(inSelectedArea), [inSelectedArea]);
  const foamTargetsKnown = useMemo(() => all.some((competition) => competition.hasFoamTargets), [all]);
  const shown = useMemo(
    () =>
      inSelectedArea.filter(
        (competition) =>
          matchesFilters(competition, filters) &&
          (problemFilter === 'all' ||
            (problemFilter === 'problems' ? competition.problems.length > 0 : isHidden(competition))),
      ),
    [inSelectedArea, filters, problemFilter],
  );

  return (
    // Centered and not wider than this: long lines across a big screen are hard to follow.
    <div className='mx-auto grid w-full max-w-7xl gap-4 p-4'>
      <header className='grid gap-1'>
        <h1 className='text-xl font-semibold tracking-tight'>Concours</h1>
        <p className='text-muted-foreground'>
          Tous les concours à venir, y compris ceux que le public ne voit pas. Ouvrez une ligne pour voir le détail d’un
          problème.
        </p>
      </header>

      <div className='flex flex-wrap items-start gap-3'>
        <CompetitionFilterBar
          className='max-w-xl min-w-80 flex-1 border-0 p-0'
          department={area}
          departmentCodes={departmentCodes}
          onDepartmentChange={setArea}
          filters={filters}
          onFiltersChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
          towns={towns}
          foamTargetsKnown={foamTargetsKnown}
          resultCount={shown.length}
        />
        <Select value={problemFilter} onValueChange={(value) => setProblemFilter(value as ProblemFilter)}>
          <SelectTrigger aria-label='Problèmes' className='min-w-64'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Tous les concours</SelectItem>
            <SelectItem value='problems'>Seulement ceux qui ont un problème</SelectItem>
            <SelectItem value='hidden'>Seulement ceux masqués au public</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {message && (
        <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
          {message}
        </p>
      )}
      {competitions === null && !message && <p className='text-muted-foreground'>Chargement…</p>}

      {competitions && (
        <>
          <p className='text-muted-foreground text-sm' aria-live='polite'>
            {shown.length} {shown.length > 1 ? 'concours affichés' : 'concours affiché'}
          </p>
          {/* Scrolls sideways on phones instead of squeezing the columns. */}
          <div className='overflow-x-auto rounded-lg border'>
            <table className='w-full min-w-240 border-collapse text-left'>
              <thead className='bg-muted whitespace-nowrap'>
                <tr>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    Date
                  </th>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    Concours
                  </th>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    Ville
                  </th>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    Dép.
                  </th>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    Discipline
                  </th>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    État
                  </th>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    Problèmes
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((competition) => (
                  <CompetitionRow
                    key={competition.id}
                    competition={competition}
                    open={openId === competition.id}
                    onToggle={() => setOpenId(openId === competition.id ? null : competition.id)}
                    scraperAvailable={scraperAvailable}
                    onOpenRegistrations={onOpenRegistrations}
                    onOpenScraper={onOpenScraper}
                    onSessionExpired={onSessionExpired}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

type RowProps = Props & {
  competition: CompetitionOverviewDto;
  open: boolean;
  onToggle: () => void;
  scraperAvailable: boolean;
};

function CompetitionRow({
  competition,
  open,
  onToggle,
  scraperAvailable,
  onOpenRegistrations,
  onOpenScraper,
  onSessionExpired,
}: RowProps) {
  const detailsId = `competition-${competition.id}-details`;
  return (
    <>
      <tr
        className={cn('hover:bg-muted/60 cursor-pointer border-t', competition.isCancelled && 'text-muted-foreground')}
        onClick={onToggle}
      >
        <td className='px-3 py-2 whitespace-nowrap tabular-nums'>
          {/* The real control for keyboards and screen readers; a click anywhere on the row does the same. */}
          <button
            type='button'
            className='flex items-center gap-1 text-left'
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            <ChevronRightIcon className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')} />
            {dateLabel(competition)}
          </button>
        </td>
        <td className='px-3 py-2 font-medium'>
          {competition.title}
          {competition.hasParaTir && <Badge className='ml-2 bg-sky-100 text-sky-900'>Para-tir</Badge>}
        </td>
        <td className='px-3 py-2'>{competition.town}</td>
        <td className='px-3 py-2 tabular-nums'>{competition.departmentCode}</td>
        <td className='px-3 py-2 whitespace-nowrap'>{DISCIPLINE_LABELS[competition.discipline]}</td>
        <td className='px-3 py-2 whitespace-nowrap'>{stateLabel(competition)}</td>
        <td className='px-3 py-2'>
          <div className='flex flex-wrap gap-1'>
            {competition.problems.map((problem) => (
              <Badge
                key={problem.kind}
                className={SERIOUS.has(problem.kind) ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}
              >
                {SHORT_LABELS[problem.kind]}
              </Badge>
            ))}
          </div>
        </td>
      </tr>
      {open && (
        <tr id={detailsId} className='bg-muted/40'>
          <td colSpan={7} className='px-3 py-3'>
            <CompetitionDetails
              competition={competition}
              scraperAvailable={scraperAvailable}
              onOpenRegistrations={onOpenRegistrations}
              onOpenScraper={onOpenScraper}
              onSessionExpired={onSessionExpired}
            />
          </td>
        </tr>
      )}
    </>
  );
}

type DetailsProps = Props & { competition: CompetitionOverviewDto; scraperAvailable: boolean };

function CompetitionDetails({
  competition,
  scraperAvailable,
  onOpenRegistrations,
  onOpenScraper,
  onSessionExpired,
}: DetailsProps) {
  const [starting, setStarting] = useState(false);
  const [result, setResult] = useState<{ started: boolean; text: string } | null>(null);

  async function update() {
    setStarting(true);
    const response = await api<StartScraperRunResponse>(API_ROUTES.adminScraperRuns, {
      method: 'POST',
      body: { kind: 'competition', fftaId: competition.id },
    });
    setStarting(false);
    if (response.ok) {
      setResult({
        started: true,
        text: 'La mise à jour est lancée. Elle prend quelques secondes ; rechargez la page pour voir le résultat.',
      });
    } else if (response.error === 'admin_sign_in_required') {
      onSessionExpired();
    } else {
      setResult({ started: false, text: ERROR_MESSAGES[response.error] });
    }
  }

  const count = competition.clubArcherCount;
  return (
    <div className='grid gap-3'>
      {competition.problems.length === 0 ? (
        <p className='text-muted-foreground'>Aucun problème pour ce concours.</p>
      ) : (
        <ul className='grid gap-2'>
          {competition.problems.map((problem) => (
            <li key={problem.kind} className='grid gap-1'>
              <span>{problemText(problem)}</span>
              {'details' in problem && problem.details.length > 0 && (
                <ul className='text-muted-foreground grid gap-0.5 pl-4 text-sm'>
                  {problem.details.map((detail, index) => (
                    <li key={index} className='list-disc'>
                      {detail}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className='flex flex-wrap items-center gap-2'>
        <Button variant='outline' disabled={!scraperAvailable || starting} onClick={() => void update()}>
          <RefreshCwIcon className={cn(starting && 'animate-spin')} />
          Mettre à jour ce concours
        </Button>
        {count > 0 && (
          <Button variant='outline' onClick={() => onOpenRegistrations(competition.id)}>
            <UsersIcon />
            {`Voir les inscriptions (${count} ${count > 1 ? 'archers' : 'archer'})`}
          </Button>
        )}
        {competition.mandateUrl && (
          <Button variant='ghost' asChild>
            <a href={competition.mandateUrl} target='_blank' rel='noopener'>
              <FileTextIcon />
              Mandat (PDF)
            </a>
          </Button>
        )}
        <Button variant='ghost' asChild>
          <a href={`https://www.ffta.fr/epreuve/${competition.id}`} target='_blank' rel='noopener'>
            <ExternalLinkIcon />
            Fiche FFTA
          </a>
        </Button>
      </div>

      {!scraperAvailable && (
        <p className='text-muted-foreground text-sm'>
          Les mises à jour ne sont pas possibles sur ce serveur : aucun navigateur n’y est installé.
        </p>
      )}
      {result && (
        <p role='status' className={cn('text-sm', !result.started && 'text-amber-900')}>
          {result.text}{' '}
          {result.started && (
            <button type='button' className='text-primary underline' onClick={onOpenScraper}>
              Suivre la mise à jour
            </button>
          )}
        </p>
      )}
    </div>
  );
}
