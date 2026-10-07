import {
  DEPARTMENT_NAMES,
  DISCIPLINE_LABELS,
  DISCIPLINES,
  type Discipline,
  type GeoPosition,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import { ListIcon, MapIcon, MapPinIcon, ShieldCheckIcon, TargetIcon, UserRoundIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RegistrationActionsProvider, useRegistrationActions } from '@/registrations/registration-actions';

import { CompetitionList } from './competitions/competition-list';
import { CompetitionMap, type FocusRequest } from './competitions/competition-map';
import { DISCIPLINE_COLORS } from './competitions/disciplines';
import { useCompetitions } from './competitions/use-competitions';

const ALL = 'all';
const PARA_TIR = 'para-tir';
const DEFAULT_DEPARTMENT = '44';
const DEPARTMENT_STORAGE_KEY = 'department';

type DisciplineFilter = typeof ALL | typeof PARA_TIR | Discipline;

/** The stored choice if it is still offered, else the club's département, else all of France. */
function chooseDepartment(stored: string | null, departmentCodes: string[]): string {
  if (stored === ALL) return ALL;
  if (stored && departmentCodes.includes(stored)) return stored;
  if (departmentCodes.includes(DEFAULT_DEPARTMENT)) return DEFAULT_DEPARTMENT;
  return ALL;
}

export function App() {
  const [state, reloadCompetitions] = useCompetitions();
  const [storedDepartment, setStoredDepartment] = useState(() => localStorage.getItem(DEPARTMENT_STORAGE_KEY));
  const [disciplineFilter, setDisciplineFilter] = useState<DisciplineFilter>(ALL);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  /** Phones show either the list or the map; wider screens show both side by side. */
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  const competitions = useMemo(() => (state.kind === 'loaded' ? state.competitions : []), [state]);
  const departmentCodes = useMemo(
    () => [...new Set(competitions.map((competition) => competition.departmentCode))].toSorted(),
    [competitions],
  );

  const department = chooseDepartment(storedDepartment, departmentCodes);

  const inDepartment = useMemo(
    () =>
      department === ALL
        ? competitions
        : competitions.filter((competition) => competition.departmentCode === department),
    [competitions, department],
  );
  const framedPositions = useMemo(
    () =>
      department === ALL
        ? []
        : inDepartment.flatMap((competition) => (competition.position ? [competition.position] : [])),
    [department, inDepartment],
  ) satisfies GeoPosition[];
  // Kept stable between renders: the map re-places its markers (and an open popup) when this array changes.
  const shown = useMemo(
    () =>
      inDepartment.filter((competition) => {
        if (disciplineFilter === ALL) return true;
        if (disciplineFilter === PARA_TIR) return competition.hasParaTir;
        return competition.discipline === disciplineFilter;
      }),
    [inDepartment, disciplineFilter],
  );

  function selectDepartment(value: string) {
    localStorage.setItem(DEPARTMENT_STORAGE_KEY, value);
    setStoredDepartment(value);
  }

  function showOnMap(competitionId: string) {
    setMobileView('map');
    setFocusRequest({ competitionId, requestedAt: Date.now() });
  }

  const area = department === ALL ? 'France' : (DEPARTMENT_NAMES[department] ?? department);

  return (
    <RegistrationActionsProvider onRegistrationsChanged={reloadCompetitions}>
      <div className='flex h-svh flex-col'>
        <header className='flex h-14 shrink-0 items-center gap-2 border-b px-4'>
          <TargetIcon className='text-primary size-6 shrink-0' />
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
            <div className='flex flex-wrap gap-2 border-b p-3'>
              <Select value={department} onValueChange={selectDepartment}>
                <SelectTrigger
                  aria-label='Département'
                  className='min-w-48 flex-1 rounded-full *:data-[slot=select-value]:flex-1'
                >
                  <MapPinIcon />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Toute la France</SelectItem>
                  {departmentCodes.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                      {DEPARTMENT_NAMES[code] && ` - ${DEPARTMENT_NAMES[code]}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={disciplineFilter}
                onValueChange={(value) => setDisciplineFilter(value as DisciplineFilter)}
              >
                <SelectTrigger
                  aria-label='Discipline'
                  className='min-w-48 flex-1 rounded-full *:data-[slot=select-value]:flex-1'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Toutes les disciplines</SelectItem>
                  {DISCIPLINES.map((discipline) => (
                    <SelectItem key={discipline} value={discipline}>
                      <span className='size-3 rounded-full' style={{ background: DISCIPLINE_COLORS[discipline] }} />
                      {DISCIPLINE_LABELS[discipline]}
                    </SelectItem>
                  ))}
                  <SelectItem value={PARA_TIR}>
                    <span className='size-3 rounded-full bg-sky-500' />
                    Para-tir
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className='bg-muted/30 min-h-0 flex-1 overflow-y-auto p-4 pb-24 md:pb-4'>
              {state.kind === 'loading' && <p className='text-muted-foreground'>Chargement des concours…</p>}
              {state.kind === 'error' && <p className='text-destructive'>Impossible de charger les concours.</p>}
              {state.kind === 'loaded' && (
                <>
                  <h1 className='mb-3 text-xl font-semibold tracking-tight'>
                    {shown.length} concours à venir – {area}
                  </h1>
                  <CompetitionList competitions={shown} allFrance={department === ALL} onShowOnMap={showOnMap} />
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
    <Button variant='outline' className='shrink-0' asChild>
      <a href='/admin' title='Administration' aria-label='Administration'>
        <ShieldCheckIcon />
        {/* Icon only on phones: the header is narrow there. */}
        <span className='max-sm:hidden'>Administration</span>
      </a>
    </Button>
  );
}
