import type { Archer } from './archer.ts';

export type MemberListSummary = {
  readonly added: number;
  readonly updated: number;
  /** Members missing from the new export: they left the club and can no longer sign in. */
  readonly deactivated: number;
  readonly unchanged: number;
};

export type MemberListSync = {
  /** New and changed members. */
  readonly toSave: readonly Archer[];
  /** Licence numbers of active members missing from the export. */
  readonly toDeactivate: readonly string[];
  readonly memberCount: number;
  readonly summary: MemberListSummary;
};

/**
 * Makes the member list match a full FFTA export. Members are never deleted: their past registrations point to them.
 */
export function planMemberListSync(current: readonly Archer[], exported: readonly Archer[]): MemberListSync {
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
  const inExport = new Set(exported.map((archer) => archer.licenceNumber));
  const toDeactivate = current
    .filter((archer) => archer.isActive && !inExport.has(archer.licenceNumber))
    .map((archer) => archer.licenceNumber);
  return {
    toSave,
    toDeactivate,
    memberCount: exported.length,
    summary: {
      added,
      updated: toSave.length - added,
      deactivated: toDeactivate.length,
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
  /** `false` when no member has this licence number. */
  setActive(licenceNumber: string, isActive: boolean): Promise<boolean>;
}
