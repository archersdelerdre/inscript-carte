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
  event: CalendarEvent;
  /** Stable per archer and competition: adding it twice updates the same event in most calendars. */
  uid: string;
  variant?: 'default' | 'outline';
};

/** The site cannot write into a calendar: it opens one already filled in, the archer saves it. */
export function AddToCalendarButton({ event, uid, variant = 'outline' }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant}>
          <CalendarPlusIcon />
          Ajouter à mon agenda
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        <DropdownMenuItem onSelect={() => window.open(googleCalendarUrl(event), '_blank', 'noopener')}>
          Google Agenda
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => downloadIcs(event, uid)}>Autre agenda (iPhone, Outlook…)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
