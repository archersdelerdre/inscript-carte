import type { Archer, ExportedMember } from './archer.ts';

export type MemberListSummary = {
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
};

export type MemberListSync = {
  /** New and changed members. */
  readonly toSave: readonly ExportedMember[];
  readonly memberCount: number;
  readonly summary: MemberListSummary;
};

/**
 * Adds the new members of an FFTA export and updates the others, their state ("Etat") included. Members missing from
 * the file are not touched (the user decided it).
 */
export function planMemberListSync(current: readonly Archer[], exported: readonly ExportedMember[]): MemberListSync {
  const existing = new Map(current.map((archer) => [archer.licenceNumber, archer]));
  let added = 0;
  const toSave = exported.filter((archer) => {
    const known = existing.get(archer.licenceNumber);
    if (!known) added++;
    return (
      !known ||
      known.fullName !== archer.fullName ||
      known.sex !== archer.sex ||
      known.birthDate !== archer.birthDate ||
      known.isActive !== archer.isActive
    );
  });
  return {
    toSave,
    memberCount: exported.length,
    summary: {
      added,
      updated: toSave.length - added,
      unchanged: exported.length - toSave.length,
    },
  };
}

/** When the member list was last imported, and by whom. */
export type MemberImport = MemberListSummary & {
  /** ISO date and time (UTC). */
  readonly importedAt: string;
  /** `null` when imported from the command line. */
  readonly importedByName: string | null;
  readonly memberCount: number;
};

export interface MemberListRepository {
  /** Reads the members, lets `plan` decide, then applies the changes and records the import, in one transaction. */
  sync(plan: (current: readonly Archer[]) => MemberListSync, importedBy: string | null): Promise<MemberListSummary>;
  lastImport(): Promise<MemberImport | null>;
  countActive(): Promise<number>;
  /** Every member, those who left included. */
  all(): Promise<Archer[]>;
  /** `false` when no member has this licence number. `updatedBy`: the admin's licence number. */
  update(licenceNumber: string, changes: MemberChanges, updatedBy: string): Promise<boolean>;
  /** For a member who forgot it; `false` when no member has this licence number. */
  removePassword(licenceNumber: string): Promise<boolean>;
}

export type MemberChanges = Partial<Pick<Archer, 'isActive' | 'clubPaysRegistrations'>> & {
  /** The club gave the credit back (or wrote it off): it goes to zero. */
  readonly clearCredit?: true;
};
