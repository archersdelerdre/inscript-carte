import type { Discipline } from '@inscript-carte/shared';

export const DISCIPLINE_COLORS: Record<Discipline, string> = {
  salle: '#1f4e79',
  exterieur: '#7b4fa3',
  campagne: '#c0392b',
  '3d': '#d9822b',
  nature: '#2e8b57',
  beursault: '#8d6e63',
  loisirs: '#4a9d8f',
  autres: '#666666',
};

/** Map dot color for a town hosting several disciplines. */
export const MIXED_DISCIPLINES_COLOR = '#444444';
