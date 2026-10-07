import {
  DEPARTMENT_NAMES,
  DISCIPLINE_LABELS,
  DISCIPLINES,
  type CompetitionDto,
  type Discipline,
} from '@inscript-carte/shared';
import { MapPinIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDay } from '@/lib/dates';
import { matchesSearch } from '@/lib/search';

import { DISCIPLINE_COLORS } from './disciplines';
import { TownSearch, type TownSuggestion } from './town-search';

export const ALL = 'all';
const PARA_TIR = 'para-tir';
const TOWN_SEARCH_DELAY_MS = 300;

type DisciplineFilter = typeof ALL | typeof PARA_TIR | Discipline;

/** Everything but the département, which is remembered on the device and kept by `App`. */
export type CompetitionFilters = {
  discipline: DisciplineFilter;
  /** `YYYY-MM-DD`, or empty for no limit. */
  from: string;
  to: string;
  withClubArchers: boolean;
  town: string;
};

export const NO_FILTERS: CompetitionFilters = { discipline: ALL, from: '', to: '', withClubArchers: false, town: '' };

export function matchesFilters(competition: CompetitionDto, filters: CompetitionFilters): boolean {
  if (filters.discipline === PARA_TIR && !competition.hasParaTir) return false;
  if (filters.discipline !== ALL && filters.discipline !== PARA_TIR && competition.discipline !== filters.discipline)
    return false;
  // A competition over several days is kept if one of its days is in the range.
  if (filters.from && competition.endDate < filters.from) return false;
  if (filters.to && competition.startDate > filters.to) return false;
  if (filters.withClubArchers && competition.clubArcherCount === 0) return false;
  return matchesSearch(filters.town, competition.town);
}

function dateRangeLabel(from: string, to: string): string {
  if (from && to) return `Du ${formatDay(from)} au ${formatDay(to)}`;
  if (from) return `À partir du ${formatDay(from)}`;
  return `Jusqu'au ${formatDay(to)}`;
}

function DisciplineDot({ discipline }: { discipline: DisciplineFilter }) {
  if (discipline === ALL) return null;
  const color = discipline === PARA_TIR ? undefined : DISCIPLINE_COLORS[discipline];
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
  resultCount: number;
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
  resultCount,
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

  const chips: Chip[] = [];
  if (filters.discipline !== ALL) {
    const text = filters.discipline === PARA_TIR ? 'Para-tir' : DISCIPLINE_LABELS[filters.discipline];
    chips.push({
      key: 'discipline',
      text,
      icon: <DisciplineDot discipline={filters.discipline} />,
      remove: () => change({ discipline: ALL }),
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

  /** The département stays: it has its own menu in the bar, remembered on the device. */
  function clearFilters() {
    change({ discipline: ALL, from: '', to: '', withClubArchers: false });
  }

  const departmentName = DEPARTMENT_NAMES[department] ?? department;

  return (
    <div className='flex flex-col gap-2 border-b p-3'>
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
              aria-label='Département'
              className='hover:bg-muted h-full shrink-0 gap-1.5 rounded-l-full rounded-r-none border-0 pr-2 pl-3 focus-visible:ring-0 data-[size=default]:h-full'
            >
              <MapPinIcon className='text-muted-foreground size-4' />
              {/* Phones show the code only: the town needs the room. */}
              <SelectValue>
                <span className='sm:hidden'>{department === ALL ? 'France' : department}</span>
                <span className='max-sm:hidden'>{department === ALL ? 'Toute la France' : departmentName}</span>
              </SelectValue>
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
            <DialogDescription>La liste et la carte changent tout de suite.</DialogDescription>
          </DialogHeader>

          <div className='grid gap-2'>
            <Label htmlFor='filter-discipline'>Discipline</Label>
            <Select
              value={filters.discipline}
              onValueChange={(value) => change({ discipline: value as DisciplineFilter })}
            >
              <SelectTrigger id='filter-discipline' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Toutes les disciplines</SelectItem>
                {DISCIPLINES.map((discipline) => (
                  <SelectItem key={discipline} value={discipline}>
                    <DisciplineDot discipline={discipline} />
                    {DISCIPLINE_LABELS[discipline]}
                  </SelectItem>
                ))}
                <SelectItem value={PARA_TIR}>
                  <DisciplineDot discipline={PARA_TIR} />
                  Para-tir
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <fieldset className='grid gap-2'>
            <legend className='mb-2 font-medium'>Dates</legend>
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
          </fieldset>

          <Label htmlFor='filter-club' className='min-h-10 cursor-pointer'>
            <Checkbox
              id='filter-club'
              checked={filters.withClubArchers}
              onCheckedChange={(checked) => change({ withClubArchers: checked === true })}
            />
            Seulement les concours avec des inscrits du club
          </Label>

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
