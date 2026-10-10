import { CalendarPlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { downloadIcs, googleCalendarUrl, type CalendarEvent } from './calendar';

type Props = {
  events: CalendarEvent[];
  /** Stable per archer and competition: adding it again updates the same events in most calendars. */
  uid: string;
};

/**
 * The site cannot write into a calendar: it opens one already filled in, the archer saves it. A Google link holds
 * one event, so there is one line per départ; the `.ics` file holds them all.
 */
export function AddToCalendarButton({ events, uid }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline'>
          <CalendarPlusIcon />
          Ajouter à mon agenda
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        {events.map((event) => (
          <DropdownMenuItem
            key={event.name}
            onSelect={() => window.open(googleCalendarUrl(event), '_blank', 'noopener')}
          >
            {events.length > 1 ? `Google Agenda : ${event.name}` : 'Google Agenda'}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => downloadIcs(events, uid)}>Autre agenda (iPhone, Outlook…)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
