import type { GeoPosition } from '@inscript-carte/shared';
import { cn } from 'cn';
import { ListIcon, MapIcon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useSession } from '@/auth/session';
import { TargetLogo } from '@/components/target-logo';
import { Button } from '@/components/ui/button';
import { RegistrationActionsProvider, useRegistrationActions } from '@/registrations/registration-actions';

import { ALL_FRANCE, areaDepartments, areaName, isOfferedArea } from './competitions/areas';
import {
  CompetitionFilterBar,
  type CompetitionFilters,
  matchesFilters,
  NO_FILTERS,
} from './competitions/competition-filters';
import { CompetitionList } from './competitions/competition-list';
import { CompetitionMap, type FocusRequest } from './competitions/competition-map';
import { townSuggestions } from './competitions/town-search';
import { useCompetitions } from './competitions/use-competitions';

const DEFAULT_DEPARTMENT = '44';
const DEPARTMENT_STORAGE_KEY = 'department';

/** The stored choice if it is still offered, else the club's département, else all of France. */
function chooseArea(stored: string | null, departmentCodes: string[]): string {
  if (stored === ALL_FRANCE) return ALL_FRANCE;
  if (stored && isOfferedArea(stored, departmentCodes)) return stored;
  if (departmentCodes.includes(DEFAULT_DEPARTMENT)) return DEFAULT_DEPARTMENT;
  return ALL_FRANCE;
}

export function App() {
  const [state, reloadCompetitions] = useCompetitions();
  const [storedDepartment, setStoredDepartment] = useState(() => localStorage.getItem(DEPARTMENT_STORAGE_KEY));
  const [filters, setFilters] = useState<CompetitionFilters>(NO_FILTERS);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  /** Phones show either the list or the map; wider screens show both side by side. */
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  const competitions = useMemo(() => (state.kind === 'loaded' ? state.competitions : []), [state]);
  const departmentCodes = useMemo(
    () => [...new Set(competitions.map((competition) => competition.departmentCode))].toSorted(),
    [competitions],
  );

  const department = chooseArea(storedDepartment, departmentCodes);

  const inDepartment = useMemo(() => {
    const departments = areaDepartments(department);
    return departments
      ? competitions.filter((competition) => departments.has(competition.departmentCode))
      : competitions;
  }, [competitions, department]);
  const framedPositions = useMemo(
    () =>
      department === ALL_FRANCE
        ? []
        : inDepartment.flatMap((competition) => (competition.position ? [competition.position] : [])),
    [department, inDepartment],
  ) satisfies GeoPosition[];
  // Kept stable between renders: the map re-places its markers (and an open popup) when this array changes.
  const shown = useMemo(
    () => inDepartment.filter((competition) => matchesFilters(competition, filters)),
    [inDepartment, filters],
  );
  const towns = useMemo(() => townSuggestions(inDepartment), [inDepartment]);
  const foamTargetsKnown = useMemo(
    () => competitions.some((competition) => competition.hasFoamTargets),
    [competitions],
  );

  function selectDepartment(value: string) {
    localStorage.setItem(DEPARTMENT_STORAGE_KEY, value);
    setStoredDepartment(value);
  }

  function showOnMap(competitionId: string) {
    setMobileView('map');
    setFocusRequest({ competitionId, requestedAt: Date.now() });
  }

  const area = areaName(department);

  return (
    <RegistrationActionsProvider onRegistrationsChanged={reloadCompetitions}>
      <div className='flex h-svh flex-col'>
        <header className='flex h-14 shrink-0 items-center gap-2 border-b px-4'>
          <TargetLogo className='size-7 shrink-0' />
          <span className='min-w-0 truncate text-lg font-semibold tracking-tight'>
            Concours de tir à l'arc en France
          </span>
          <div className='ml-auto flex shrink-0 items-center gap-2'>
            <AdminButton />
            <MyRegistrationsButton />
          </div>
        </header>

        {/* On phones the list covers the map instead of hiding it: Leaflet must always know its real size. */}
        <div className='relative flex min-h-0 flex-1'>
          <aside
            className={cn(
              'z-10 flex min-w-0 flex-col bg-background max-md:absolute max-md:inset-0 md:w-[500px] md:shrink-0 md:border-r',
              mobileView === 'map' && 'max-md:hidden',
            )}
          >
            <CompetitionFilterBar
              department={department}
              departmentCodes={departmentCodes}
              onDepartmentChange={selectDepartment}
              filters={filters}
              onFiltersChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
              towns={towns}
              foamTargetsKnown={foamTargetsKnown}
              resultCount={shown.length}
            />

            <div className='bg-muted/30 min-h-0 flex-1 overflow-y-auto p-4 pb-24 md:pb-4'>
              {state.kind === 'loading' && <p className='text-muted-foreground'>Chargement des concours…</p>}
              {state.kind === 'error' && <p className='text-destructive'>Impossible de charger les concours.</p>}
              {state.kind === 'loaded' && (
                <>
                  <h1 className='mb-3 text-xl font-semibold tracking-tight'>
                    {shown.length} concours à venir – {area}
                  </h1>
                  <CompetitionList competitions={shown} allFrance={department === ALL_FRANCE} onShowOnMap={showOnMap} />
                </>
              )}
            </div>
          </aside>

          <main className='min-w-0 flex-1'>
            <CompetitionMap competitions={shown} framedPositions={framedPositions} focusRequest={focusRequest} />
          </main>
        </div>

        <Button
          // Fixed width and margin centering, no press offset: the button must not move when tapped.
          className='fixed inset-x-0 bottom-6 z-40 mx-auto w-32 rounded-full shadow-lg active:not-aria-[haspopup]:translate-y-0 md:hidden'
          size='lg'
          onClick={() => setMobileView(mobileView === 'list' ? 'map' : 'list')}
        >
          {mobileView === 'list' ? <MapIcon /> : <ListIcon />}
          {mobileView === 'list' ? 'Carte' : 'Liste'}
        </Button>
      </div>
    </RegistrationActionsProvider>
  );
}

function MyRegistrationsButton() {
  const { showMyRegistrations } = useRegistrationActions();
  return (
    <Button variant='outline' className='shrink-0' onClick={showMyRegistrations}>
      <UserRoundIcon />
      Mon suivi
    </Button>
  );
}

/** Only for admins. The admin page still asks for the admin password. */
function AdminButton() {
  const { archer } = useSession();
  if (!archer?.isAdmin) return null;
  return (
    <Button variant='ghost' className='shrink-0' asChild>
      <a href='/admin' title='Administration' aria-label='Administration'>
        <ShieldCheckIcon />
        {/* Icon only on phones: the header is narrow there. */}
        <span className='max-sm:hidden'>Administration</span>
      </a>
    </Button>
  );
}
