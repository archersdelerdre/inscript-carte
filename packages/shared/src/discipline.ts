export const DISCIPLINES = [
  'salle',
  'exterieur',
  'campagne',
  '3d',
  'nature',
  'beursault',
  'loisirs',
  'autres',
] as const;

export type Discipline = (typeof DISCIPLINES)[number];

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  salle: 'Salle 18m',
  exterieur: 'Extérieur',
  campagne: 'Campagne',
  '3d': '3D',
  nature: 'Nature',
  beursault: 'Beursault',
  loisirs: 'Loisirs',
  autres: 'Autres',
};
