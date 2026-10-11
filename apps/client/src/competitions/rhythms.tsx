import type { Rhythm } from '@inscript-carte/shared';
import { cn } from 'cn';

/**
 * One color per rhythm, apart from the other badges (sky Para-tir, lime Cibles mousses, amber Reportée; red is the
 * app's accent): the card's badge and the dots in the menus use the same one.
 */
const RHYTHM_COLORS: Record<Rhythm, { badge: string; dot: string }> = {
  AB: { badge: 'bg-indigo-100 text-indigo-900', dot: 'bg-indigo-500' },
  ABC: { badge: 'bg-pink-100 text-pink-900', dot: 'bg-pink-500' },
  'AB/CD': { badge: 'bg-teal-100 text-teal-900', dot: 'bg-teal-500' },
};

export function rhythmBadgeClass(rhythm: Rhythm): string {
  return RHYTHM_COLORS[rhythm].badge;
}

export function RhythmDot({ rhythm }: { rhythm: Rhythm }) {
  return <span aria-hidden className={cn('size-3 shrink-0 rounded-full', RHYTHM_COLORS[rhythm].dot)} />;
}
