import type { CompetitionDto } from '@inscript-carte/shared';
import { cn } from 'cn';
import { MapPinIcon, XIcon } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { matchesSearch, searchable } from '@/lib/search';

const MAX_SUGGESTIONS = 6;

export type TownSuggestion = { name: string; departmentCode: string; competitionCount: number };

/**
 * The FFTA text is sometimes a full address ("Gymnase…, 10, Rue de Lizy, 60440 Nanteuil le Haudouin"): what follows
 * the postal code is the town.
 */
function townName(fftaTown: string): string {
  return /\b\d{5}\s+(.+)$/.exec(fftaTown)?.[1]?.trim() ?? fftaTown.trim();
}

/** One suggestion per town and département, spelling variants ("NANTES", "Nantes") merged. */
export function townSuggestions(competitions: CompetitionDto[]): TownSuggestion[] {
  const byKey = new Map<string, TownSuggestion>();
  for (const competition of competitions) {
    const name = townName(competition.town);
    const key = `${searchable(name)}|${competition.departmentCode}`;
    const known = byKey.get(key);
    if (known) known.competitionCount += 1;
    else byKey.set(key, { name, departmentCode: competition.departmentCode, competitionCount: 1 });
  }
  return [...byKey.values()];
}

/** Towns starting with the text first, then the others containing it. */
function bestMatches(text: string, towns: TownSuggestion[]): TownSuggestion[] {
  const query = searchable(text).trim();
  if (!query) return [];
  const startsWith = (town: TownSuggestion) => searchable(town.name).startsWith(query);
  return towns
    .filter((town) => matchesSearch(text, town.name))
    .toSorted((a, b) => Number(startsWith(b)) - Number(startsWith(a)) || a.name.localeCompare(b.name, 'fr'))
    .slice(0, MAX_SUGGESTIONS);
}

/** Bold on the typed part. `searchable` keeps one character per character for French text, so indexes match. */
function Highlighted({ name, text }: { name: string; text: string }) {
  const query = searchable(text).trim();
  const start = searchable(name).indexOf(query);
  if (!query || start < 0) return <span className='truncate'>{name}</span>;
  return (
    <span className='truncate'>
      {name.slice(0, start)}
      <strong className='font-semibold'>{name.slice(start, start + query.length)}</strong>
      {name.slice(start + query.length)}
    </span>
  );
}

type Props = {
  value: string;
  placeholder: string;
  towns: TownSuggestion[];
  onType: (text: string) => void;
  onPick: (town: string) => void;
  onClear: () => void;
};

/** A search field with its own suggestion list (a WAI-ARIA combobox). The parent places it and gives it `relative`. */
export function TownSearch({ value, placeholder, towns, onType, onPick, onClear }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = bestMatches(value, towns);
  // Nothing to suggest once the text is exactly a town.
  const shown = open && suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0]?.name === value);

  function pick(town: TownSuggestion) {
    onPick(town.name);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      const active = suggestions[activeIndex];
      if (shown && active) {
        event.preventDefault();
        pick(active);
      }
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
    // -1 is the field itself: going past the last town comes back to what was typed.
    const step = event.key === 'ArrowDown' ? 1 : -1;
    setActiveIndex((index) => {
      const next = index + step;
      if (next >= suggestions.length) return -1;
      return next < -1 ? suggestions.length - 1 : next;
    });
  }

  return (
    <>
      <input
        type='search'
        role='combobox'
        aria-label='Rechercher une ville'
        aria-autocomplete='list'
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete='off'
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onType(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className='placeholder:text-muted-foreground h-8 min-w-16 flex-1 bg-transparent px-1 outline-none [&::-webkit-search-cancel-button]:hidden'
      />
      {value && (
        <Button
          variant='ghost'
          size='icon'
          className='size-8 shrink-0 rounded-full'
          aria-label='Effacer la ville'
          onClick={onClear}
        >
          <XIcon />
        </Button>
      )}
      <ul
        id={listId}
        role='listbox'
        aria-label='Villes'
        hidden={!shown}
        className='bg-popover text-popover-foreground ring-foreground/10 animate-in fade-in-0 slide-in-from-top-1 absolute inset-x-0 top-full z-30 mt-1.5 grid rounded-xl p-1 shadow-lg ring-1 duration-100'
      >
        {suggestions.map((town, index) => (
          <li
            key={`${town.name}|${town.departmentCode}`}
            id={`${listId}-${index}`}
            role='option'
            aria-selected={index === activeIndex}
            // Keeps the focus in the field, so the blur does not close the list before the click.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => pick(town)}
            className={cn(
              'flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2',
              index === activeIndex && 'bg-accent text-accent-foreground',
            )}
          >
            <MapPinIcon aria-hidden className='text-muted-foreground size-4 shrink-0' />
            <Highlighted name={town.name} text={value} />
            <span className='text-muted-foreground shrink-0 text-sm'>{town.departmentCode}</span>
            <span className='text-muted-foreground ml-auto shrink-0 pl-2 text-sm'>
              {town.competitionCount} concours
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
