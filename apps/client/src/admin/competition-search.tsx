import type { CompetitionDto } from '@inscript-carte/shared';
import { cn } from 'cn';
import { type KeyboardEvent, useEffect, useId, useState } from 'react';

import { Input } from '@/components/ui/input';
import { formatDateRange } from '@/lib/dates';
import { matchesSearch } from '@/lib/search';

const MAX_SUGGESTIONS = 8;
const SEARCH_DELAY_MS = 250;

type Props = {
  id: string;
  value: string;
  placeholder: string;
  invalid: boolean;
  competitions: CompetitionDto[];
  onType: (text: string) => void;
  onPick: (competition: CompetitionDto) => void;
};

/** A field that suggests competitions by title, town or FFTA number (a WAI-ARIA combobox, like the town search). */
export function CompetitionSearch({ id, value, placeholder, invalid, competitions, onType, onPick }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // The field shows each key at once; the suggestions follow once typing pauses.
  const [query, setQuery] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(value), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  const suggestions =
    value.trim().length < 2 || query.trim().length < 2
      ? []
      : competitions
          .filter((competition) => matchesSearch(query, `${competition.title} ${competition.town} ${competition.id}`))
          .slice(0, MAX_SUGGESTIONS);
  const shown = open && suggestions.length > 0;

  function pick(competition: CompetitionDto) {
    onPick(competition);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') return setOpen(false);
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
    // -1 is the field itself: going past the last competition comes back to what was typed.
    const step = event.key === 'ArrowDown' ? 1 : -1;
    setActiveIndex((index) => {
      const next = index + step;
      if (next >= suggestions.length) return -1;
      return next < -1 ? suggestions.length - 1 : next;
    });
  }

  return (
    <div className='relative'>
      <Input
        id={id}
        role='combobox'
        aria-autocomplete='list'
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        aria-invalid={invalid || undefined}
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
      />
      <ul
        id={listId}
        role='listbox'
        aria-label='Concours'
        hidden={!shown}
        className='bg-popover text-popover-foreground ring-foreground/10 absolute inset-x-0 top-full z-30 mt-1.5 grid max-h-96 overflow-y-auto rounded-xl p-1 shadow-lg ring-1'
      >
        {suggestions.map((competition, index) => (
          <li
            key={competition.id}
            id={`${listId}-${index}`}
            role='option'
            aria-selected={index === activeIndex}
            // Keeps the focus in the field, so the blur does not close the list before the click.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => pick(competition)}
            className={cn(
              'grid min-h-10 cursor-pointer gap-0.5 rounded-lg px-2.5 py-2',
              index === activeIndex && 'bg-accent text-accent-foreground',
            )}
          >
            <span className='leading-snug font-medium'>{competition.title}</span>
            <span className='text-muted-foreground text-sm'>
              {formatDateRange(competition.startDate, competition.endDate)} · {competition.town} (
              {competition.departmentCode}) · n° {competition.id}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
