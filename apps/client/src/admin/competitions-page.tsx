import {
  API_ROUTES,
  DISCIPLINE_LABELS,
  type CompetitionOverviewDto,
  type CompetitionOverviewResponse,
  type CompetitionProblem,
  type ScraperStatusResponse,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import { ALL_FRANCE, inArea } from '@/competitions/areas';
import {
  CompetitionFilterBar,
  type CompetitionFilters,
  matchesFilters,
  NO_FILTERS,
} from '@/competitions/competition-filters';
import { townSuggestions } from '@/competitions/town-search';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, type ApiResult } from '@/lib/api';
import { formatDay } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';

import { CompetitionEditDialog } from './competition-edit-dialog';

type ProblemFilter = 'all' | 'problems' | 'hidden';

/** Phones are slow with ~1 800 rows: the table grows by this many rows each time its end comes into view. */
const BATCH_SIZE = 100;

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
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  const showList = useCallback(
    (list: ApiResult<CompetitionOverviewResponse>) => {
      if (!list.ok) {
        if (list.error === 'admin_sign_in_required') onSessionExpired();
        else setMessage(ERROR_MESSAGES[list.error]);
        return;
      }
      setMessage(null);
      setCompetitions(list.data.competitions);
    },
    [onSessionExpired],
  );
  const loadCompetitions = useCallback(
    () => api<CompetitionOverviewResponse>(API_ROUTES.adminCompetitionOverview).then(showList),
    [showList],
  );

  useEffect(() => {
    void api<CompetitionOverviewResponse>(API_ROUTES.adminCompetitionOverview).then(showList);
    void api<ScraperStatusResponse>(API_ROUTES.adminScraper).then((scraper) =>
      setScraperAvailable(scraper.ok && scraper.data.available),
    );
  }, [showList]);

  /** Any filter change starts again from the first batch. */
  function filtered<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      setVisibleCount(BATCH_SIZE);
    };
  }

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
  const rendered = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount]);
  const hasMore = rendered.length < shown.length;
  const editing = openId === null ? undefined : all.find((competition) => competition.id === openId);

  // The sentinel sits under the table: when it scrolls into view, the next batch is added. It is a new element for
  // each batch (`key`), so one still in view on a tall screen is observed again and asks for the following batch.
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((count) => count + BATCH_SIZE);
      },
      { root: null, rootMargin: '400px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel]);

  return (
    // Centered and not wider than this: long lines across a big screen are hard to follow.
    <div className='mx-auto grid w-full max-w-7xl gap-4 p-4'>
      <header className='grid gap-1'>
        <h1 className='text-xl font-semibold tracking-tight'>Concours</h1>
        <p className='text-muted-foreground'>
          Tous les concours à venir, y compris ceux que le public ne voit pas. Ouvrez une ligne pour voir les problèmes
          d’un concours et modifier ses informations.
        </p>
      </header>

      <div className='flex flex-wrap items-start gap-3'>
        <CompetitionFilterBar
          className='max-w-xl min-w-80 flex-1 border-0 p-0'
          department={area}
          departmentCodes={departmentCodes}
          onDepartmentChange={filtered(setArea)}
          filters={filters}
          onFiltersChange={filtered((patch: Partial<CompetitionFilters>) =>
            setFilters((current) => ({ ...current, ...patch })),
          )}
          towns={towns}
          foamTargetsKnown={foamTargetsKnown}
          resultCount={shown.length}
        />
        <Select
          value={problemFilter}
          onValueChange={filtered((value: string) => setProblemFilter(value as ProblemFilter))}
        >
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
                {rendered.map((competition) => (
                  <CompetitionRow key={competition.id} competition={competition} onOpen={setOpenId} />
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && <div key={visibleCount} ref={setSentinel} aria-hidden='true' className='h-px' />}
        </>
      )}

      {editing && (
        <CompetitionEditDialog
          key={editing.id}
          competition={editing}
          scraperAvailable={scraperAvailable}
          onSaved={() => {
            void loadCompetitions();
            setOpenId(null);
          }}
          onClose={() => setOpenId(null)}
          onOpenRegistrations={onOpenRegistrations}
          onOpenScraper={onOpenScraper}
          onSessionExpired={onSessionExpired}
        />
      )}
    </div>
  );
}

type RowProps = {
  competition: CompetitionOverviewDto;
  onOpen: (competitionId: string) => void;
};

/** Memoized: with hundreds of rows, a new batch or an open dialog must not render the others again. */
const CompetitionRow = memo(function CompetitionRow({ competition, onOpen }: RowProps) {
  return (
    <tr
      className={cn('hover:bg-muted/60 cursor-pointer border-t', competition.isCancelled && 'text-muted-foreground')}
      onClick={() => onOpen(competition.id)}
    >
      <td className='px-3 py-2 whitespace-nowrap tabular-nums'>{dateLabel(competition)}</td>
      <td className='px-3 py-2 font-medium'>
        {/* The real control for keyboards and screen readers; a click anywhere on the row does the same. */}
        <button
          type='button'
          className='cursor-pointer text-left font-medium'
          aria-haspopup='dialog'
          onClick={(event) => {
            event.stopPropagation();
            onOpen(competition.id);
          }}
        >
          {competition.title}
        </button>
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
          {competition.isEdited && <Badge variant='secondary'>Modifié</Badge>}
        </div>
      </td>
    </tr>
  );
});
