export const COMPETITION_STATUSES = ['scheduled', 'postponed', 'cancelled'] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

/** "Concours" is masculine. */
export const COMPETITION_STATUS_LABELS: Record<CompetitionStatus, string> = {
  scheduled: 'Prévu',
  postponed: 'Reporté',
  cancelled: 'Annulé',
};
