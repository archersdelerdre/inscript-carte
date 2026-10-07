import type { Sex } from './registration.ts';

/** FFTA age categories, youngest first. Source: ffta.fr, "Les catégories d'âges". */
export const AGE_CATEGORIES = ['U11', 'U13', 'U15', 'U18', 'U21', 'S1', 'S2', 'S3'] as const;
export type AgeCategory = (typeof AGE_CATEGORIES)[number];

const AGE_CATEGORY_LABELS: Record<AgeCategory, string> = {
  U11: 'U11',
  U13: 'U13',
  U15: 'U15',
  U18: 'U18',
  U21: 'U21',
  S1: 'Senior 1',
  S2: 'Senior 2',
  S3: 'Senior 3',
};

/** Highest age (reached during the season's year) of each category; S3 has no limit. */
const MAX_AGE: [AgeCategory, number][] = [
  ['U11', 10],
  ['U13', 12],
  ['U15', 14],
  ['U18', 17],
  ['U21', 20],
  ['S1', 39],
  ['S2', 59],
];

/**
 * An FFTA season N runs from 1 September N-1 to 31 August N, and the category depends only on the age reached
 * during year N: an archer born in 1987 is Senior 2 for every competition of the 2026-2027 season.
 */
export function ageCategory(birthYear: number, competitionDate: string): AgeCategory {
  const [year, month] = competitionDate.split('-').map(Number);
  const seasonYear = month! >= 9 ? year! + 1 : year!;
  const age = seasonYear - birthYear;
  return MAX_AGE.find(([, maxAge]) => age <= maxAge)?.[0] ?? 'S3';
}

/** "Senior 1 Homme", "U15 Femme". */
export function categoryLabel(category: AgeCategory, sex: Sex): string {
  return `${AGE_CATEGORY_LABELS[category]} ${sex === 'female' ? 'Femme' : 'Homme'}`;
}
