import {
  allowedRhythms,
  DEPARTMENT_NAMES,
  DISCIPLINE_LABELS,
  DISCIPLINES,
  RHYTHMS,
  type CompetitionDto,
  type Discipline,
  type Rhythm,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import { FileTextIcon, MapPinIcon, SearchIcon, SlidersHorizontalIcon, UsersIcon, XIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDay } from '@/lib/dates';
import { matchesSearch } from '@/lib/search';

import { ALL_FRANCE, areaName, groupDepartments, regionArea } from './areas';
import { FOAM_TARGETS_BADGE, PARA_TIR_BADGE } from './badges';
import { DISCIPLINE_COLORS } from './disciplines';
import { RhythmDot } from './rhythms';
import { TownSearch, type TownSuggestion } from './town-search';

const ALL = 'all';
const TOWN_SEARCH_DELAY_MS = 300;

/** Everything but the département, which is remembered on the device and kept by `App`. */
export type CompetitionFilters = {
  /** Several at once (asked by a member: « Campagne + 3D + Nature »); empty for every discipline. */
  disciplines: Discipline[];
  paraTir: boolean;
  /** `YYYY-MM-DD`, or empty for no limit. */
  from: string;
  to: string;
  withClubArchers: boolean;
  foamTargets: boolean;
  /** The club takes registrations only once the mandate is out. */
  withMandate: boolean;
  /** Competitions whose rhythm is not known are left out once one is chosen. */
  rhythm: typeof ALL | Rhythm;
  town: string;
};

export const NO_FILTERS: CompetitionFilters = {
  disciplines: [],
  paraTir: false,
  from: '',
  to: '',
  withClubArchers: false,
  foamTargets: false,
  withMandate: false,
  rhythm: ALL,
  town: '',
};

/** What the filters read: the public list and the admins' « Concours » table both have it. */
export type FilterableCompetition = Pick<
  CompetitionDto,
  | 'discipline'
  | 'hasParaTir'
  | 'startDate'
  | 'endDate'
  | 'clubArcherCount'
  | 'hasFoamTargets'
  | 'rhythm'
  | 'town'
  | 'mandateUrl'
>;

export function matchesFilters(competition: FilterableCompetition, filters: CompetitionFilters): boolean {
  if (filters.paraTir && !competition.hasParaTir) return false;
  if (filters.disciplines.length > 0 && !filters.disciplines.includes(competition.discipline)) return false;
  // A competition over several days is kept if one of its days is in the range.
  if (filters.from && competition.endDate < filters.from) return false;
  if (filters.to && competition.startDate > filters.to) return false;
  if (filters.withClubArchers && competition.clubArcherCount === 0) return false;
  if (filters.foamTargets && !competition.hasFoamTargets) return false;
  if (filters.withMandate && !competition.mandateUrl) return false;
  if (filters.rhythm !== ALL && competition.rhythm !== filters.rhythm) return false;
  return matchesSearch(filters.town, competition.town);
}

/** Every rhythm while no discipline is chosen; else those the chosen disciplines allow (none off targets). */
function rhythmsFor(disciplines: readonly Discipline[]): readonly Rhythm[] {
  if (disciplines.length === 0) return RHYTHMS;
  return RHYTHMS.filter((rhythm) => disciplines.some((discipline) => allowedRhythms(discipline).includes(rhythm)));
}

/** The disciplines that have a rhythm: « Salle 18m et Extérieur » for the label, « … ou … » for the hint. */
const RHYTHM_DISCIPLINE_LABELS = DISCIPLINES.filter((discipline) => allowedRhythms(discipline).length > 0).map(
  (discipline) => DISCIPLINE_LABELS[discipline],
);
const RHYTHM_DISCIPLINES = RHYTHM_DISCIPLINE_LABELS.join(' et ');

function dateRangeLabel(from: string, to: string): string {
  if (from && to) return `Du ${formatDay(from)} au ${formatDay(to)}`;
  if (from) return `À partir du ${formatDay(from)}`;
  return `Jusqu'au ${formatDay(to)}`;
}

function DisciplineDot({ discipline }: { discipline: Discipline | 'para-tir' }) {
  const color = discipline === 'para-tir' ? undefined : DISCIPLINE_COLORS[discipline];
  return <span aria-hidden className='size-3 shrink-0 rounded-full bg-sky-500' style={{ background: color }} />;
}

type Chip = { key: string; text: string; icon?: ReactNode; remove: () => void };

type Props = {
  department: string;
  departmentCodes: string[];
  onDepartmentChange: (department: string) => void;
  filters: CompetitionFilters;
  /** Only the filters that change; the others stay. */
  onFiltersChange: (patch: Partial<CompetitionFilters>) => void;
  /** Suggested while typing a town. */
  towns: TownSuggestion[];
  /** `false` while no competition says whether it uses foam targets (the scraper will add it). */
  foamTargetsKnown: boolean;
  resultCount: number;
  /** Replaces the frame made for the side panel (a bottom border and padding). */
  className?: string;
};

/**
 * Where (département and town) sits in one pill, always on one line. The other filters live behind the icon button;
 * once chosen, they show as removable chips on a second line, only then.
 */
export function CompetitionFilterBar({
  department,
  departmentCodes,
  onDepartmentChange,
  filters,
  onFiltersChange: change,
  towns,
  foamTargetsKnown,
  resultCount,
  className,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  // The field shows each key at once; the list and the map (heavier) follow once typing pauses.
  const [townText, setTownText] = useState(filters.town);
  const townTimer = useRef<number>(undefined);

  function typeTown(text: string) {
    setTownText(text);
    window.clearTimeout(townTimer.current);
    townTimer.current = window.setTimeout(() => change({ town: text }), TOWN_SEARCH_DELAY_MS);
  }

  function pickTown(town: string) {
    window.clearTimeout(townTimer.current);
    setTownText(town);
    change({ town });
  }

  function clearTown() {
    window.clearTimeout(townTimer.current);
    setTownText('');
    change({ town: '' });
  }

  const chips: Chip[] = filters.disciplines.map((discipline) => ({
    key: `discipline-${discipline}`,
    text: DISCIPLINE_LABELS[discipline],
    icon: <DisciplineDot discipline={discipline} />,
    remove: () => toggleDiscipline(discipline),
  }));
  if (filters.paraTir) {
    const text = 'Para-tir';
    chips.push({
      key: 'para-tir',
      text,
      icon: <DisciplineDot discipline='para-tir' />,
      remove: () => change({ paraTir: false }),
    });
  }
  if (filters.from || filters.to) {
    const text = dateRangeLabel(filters.from, filters.to);
    chips.push({ key: 'dates', text, remove: () => change({ from: '', to: '' }) });
  }
  if (filters.withClubArchers) {
    const text = 'Avec des inscrits du club';
    chips.push({ key: 'club', text, remove: () => change({ withClubArchers: false }) });
  }
  if (filters.foamTargets) {
    const text = 'Cibles mousses';
    chips.push({ key: 'foam', text, remove: () => change({ foamTargets: false }) });
  }
  if (filters.withMandate) {
    const text = 'Avec un mandat';
    chips.push({ key: 'mandate', text, remove: () => change({ withMandate: false }) });
  }
  if (filters.rhythm !== ALL) {
    const text = `Rythme ${filters.rhythm}`;
    chips.push({ key: 'rhythm', text, remove: () => change({ rhythm: ALL }) });
  }

  function toggleDiscipline(discipline: Discipline) {
    const disciplines = filters.disciplines.includes(discipline)
      ? filters.disciplines.filter((chosen) => chosen !== discipline)
      : DISCIPLINES.filter((known) => known === discipline || filters.disciplines.includes(known));
    // A rhythm the chosen disciplines cannot have would hide every competition.
    const keepsRhythm = filters.rhythm === ALL || rhythmsFor(disciplines).includes(filters.rhythm);
    change(keepsRhythm ? { disciplines } : { disciplines, rhythm: ALL });
  }

  /** The département stays: it has its own menu in the bar, remembered on the device. */
  function clearFilters() {
    change({ ...NO_FILTERS, town: filters.town });
  }

  const rhythms = rhythmsFor(filters.disciplines);

  const isDepartment = department !== ALL_FRANCE && DEPARTMENT_NAMES[department] !== undefined;

  return (
    <div className={cn('flex flex-col gap-2 border-b p-3', className)}>
      <div className='flex items-center gap-2'>
        <Button
          variant='outline'
          size='icon'
          className='relative shrink-0 rounded-full'
          aria-label={chips.length > 0 ? `Filtres, ${chips.length} choisis` : 'Filtres'}
          onClick={() => setDialogOpen(true)}
        >
          <SlidersHorizontalIcon />
          {chips.length > 0 && (
            <span
              aria-hidden
              className='bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full text-sm leading-none'
            >
              {chips.length}
            </span>
          )}
        </Button>

        {/* `relative` places the town suggestions under the whole pill. */}
        <div className='border-input focus-within:border-ring focus-within:ring-ring/50 relative flex h-10 min-w-0 flex-1 items-center rounded-full border focus-within:ring-3'>
          <Select value={department} onValueChange={onDepartmentChange}>
            <SelectTrigger
              aria-label='Département ou région'
              className='hover:bg-muted h-full max-w-[60%] min-w-0 shrink-0 gap-1.5 rounded-l-full rounded-r-none border-0 pr-2 pl-3 focus-visible:ring-0 data-[size=default]:h-full *:data-[slot=select-value]:min-w-0'
            >
              <MapPinIcon className='text-muted-foreground size-4' />
              {/* Phones show a département by its code only: the town needs the room. */}
              <SelectValue>
                <span className='truncate sm:hidden'>{isDepartment ? department : areaName(department)}</span>
                <span className='truncate max-sm:hidden'>
                  {department === ALL_FRANCE ? 'Toute la France' : areaName(department)}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FRANCE}>Toute la France</SelectItem>
              {/* Like the FFTA website: each region can be picked, above its départements. */}
              {groupDepartments(departmentCodes).map(({ region, departments }) => (
                <SelectGroup key={region?.id ?? 'others'} className='p-0'>
                  {region && (
                    <SelectItem value={regionArea(region)} className='font-semibold'>
                      {region.name}
                    </SelectItem>
                  )}
                  {departments.map((code) => (
                    <SelectItem key={code} value={code} className={region ? 'pl-6' : undefined}>
                      {code}
                      {DEPARTMENT_NAMES[code] && ` - ${DEPARTMENT_NAMES[code]}`}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          <span aria-hidden className='bg-border h-5 w-px shrink-0' />
          <SearchIcon aria-hidden className='text-muted-foreground ml-2.5 size-4 shrink-0' />
          <div className='flex min-w-0 flex-1 items-center pr-1 pl-1'>
            <TownSearch
              value={townText}
              placeholder='Ville'
              towns={towns}
              onType={typeTown}
              onPick={pickTown}
              onClear={clearTown}
            />
          </div>
        </div>
      </div>

      {chips.length > 0 && (
        <div className='flex flex-wrap items-center gap-1.5'>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type='button'
              aria-label={`Retirer le filtre « ${chip.text} »`}
              className='bg-muted hover:bg-muted-foreground/20 flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full pr-2 pl-3 text-sm whitespace-nowrap'
              onClick={chip.remove}
            >
              {chip.icon}
              <span className='truncate'>{chip.text}</span>
              <XIcon aria-hidden className='size-4 shrink-0' />
            </button>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filtres</DialogTitle>
            <DialogDescription>La liste et la carte se mettent à jour immédiatement.</DialogDescription>
          </DialogHeader>

          <FilterSection title='Disciplines' hint='Une ou plusieurs. Sans case cochée, toutes sont affichées.'>
            <div className='grid grid-cols-2 gap-x-3'>
              {DISCIPLINES.map((discipline) => (
                <Label
                  key={discipline}
                  htmlFor={`filter-${discipline}`}
                  className='min-h-10 cursor-pointer font-normal'
                >
                  <Checkbox
                    id={`filter-${discipline}`}
                    checked={filters.disciplines.includes(discipline)}
                    onCheckedChange={() => toggleDiscipline(discipline)}
                  />
                  <DisciplineDot discipline={discipline} />
                  {DISCIPLINE_LABELS[discipline]}
                </Label>
              ))}
            </div>
          </FilterSection>

          <FilterSection title='Dates'>
            <div className='grid grid-cols-2 gap-3'>
              <div className='grid gap-1'>
                <Label htmlFor='filter-from' className='text-muted-foreground font-normal'>
                  Du
                </Label>
                <Input
                  id='filter-from'
                  type='date'
                  value={filters.from}
                  max={filters.to || undefined}
                  onChange={(event) => change({ from: event.target.value })}
                />
              </div>
              <div className='grid gap-1'>
                <Label htmlFor='filter-to' className='text-muted-foreground font-normal'>
                  Au
                </Label>
                <Input
                  id='filter-to'
                  type='date'
                  value={filters.to}
                  min={filters.from || undefined}
                  onChange={(event) => change({ to: event.target.value })}
                />
              </div>
            </div>
          </FilterSection>

          {/* Each with the badge the cards show, so the member knows what to look for. */}
          <FilterSection title='Seulement les concours'>
            <Label htmlFor='filter-para-tir' className='min-h-10 cursor-pointer font-normal'>
              <Checkbox
                id='filter-para-tir'
                checked={filters.paraTir}
                onCheckedChange={(checked) => change({ paraTir: checked === true })}
              />
              <Badge className={PARA_TIR_BADGE}>Para-tir</Badge>
              adaptés au para-tir
            </Label>
            <div className='grid'>
              <Label htmlFor='filter-foam' className='min-h-10 cursor-pointer font-normal'>
                <Checkbox
                  id='filter-foam'
                  checked={filters.foamTargets}
                  onCheckedChange={(checked) => change({ foamTargets: checked === true })}
                />
                <Badge className={FOAM_TARGETS_BADGE}>Cibles mousses</Badge>
                indiquées sur le mandat
              </Label>
              {/* Disappears by itself once the scraper fills the information. */}
              {!foamTargetsKnown && (
                <p className='text-muted-foreground pl-7 text-sm'>
                  Cette information n'est pas encore disponible : pour le moment, aucun concours ne sera affiché.
                </p>
              )}
            </div>
            <Label htmlFor='filter-mandate' className='min-h-10 cursor-pointer font-normal'>
              <Checkbox
                id='filter-mandate'
                checked={filters.withMandate}
                onCheckedChange={(checked) => change({ withMandate: checked === true })}
              />
              <FileTextIcon className='text-muted-foreground size-4.5 shrink-0' />
              avec un mandat publié
            </Label>
            <Label htmlFor='filter-club' className='min-h-10 cursor-pointer font-normal'>
              <Checkbox
                id='filter-club'
                checked={filters.withClubArchers}
                onCheckedChange={(checked) => change({ withClubArchers: checked === true })}
              />
              <UsersIcon className='text-muted-foreground size-4.5 shrink-0' />
              avec des inscrits du club
            </Label>
          </FilterSection>

          {/* Named in the hint (asked by a member): only these disciplines have a rhythm. */}
          <FilterSection title='Rythme' hint={`${RHYTHM_DISCIPLINES} seulement.`}>
            <Select
              value={filters.rhythm}
              disabled={rhythms.length === 0}
              onValueChange={(value) => change({ rhythm: value as typeof ALL | Rhythm })}
            >
              <SelectTrigger aria-label='Rythme' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les rythmes</SelectItem>
                {rhythms.map((rhythm) => (
                  <SelectItem key={rhythm} value={rhythm}>
                    <RhythmDot rhythm={rhythm} />
                    {rhythm}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rhythms.length === 0 && (
              <p className='text-muted-foreground text-sm'>
                Les disciplines cochées n'ont pas de rythme : cochez {RHYTHM_DISCIPLINE_LABELS.join(' ou ')} pour
                choisir un rythme.
              </p>
            )}
            {filters.rhythm !== ALL && (
              <p className='text-muted-foreground text-sm'>
                Les concours dont le mandat ne précise pas le rythme ne sont pas affichés.
              </p>
            )}
          </FilterSection>

          <DialogFooter>
            <Button variant='ghost' onClick={clearFilters}>
              Tout effacer
            </Button>
            <DialogClose asChild>
              <Button>Voir {resultCount} concours</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One group of the filter dialog: a small title, an optional hint, a line above all but the first. */
function FilterSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className='grid gap-2 border-t pt-4 first-of-type:border-t-0 first-of-type:pt-0'>
      <legend className='contents'>
        <span className='text-muted-foreground text-sm font-semibold tracking-wide uppercase'>{title}</span>
      </legend>
      {hint && <p className='text-muted-foreground -mt-1 text-sm'>{hint}</p>}
      {children}
    </fieldset>
  );
}
