import { ageCategory, type AgeCategory } from '@inscript-carte/shared';

import type { AdminRepository } from '../domain/admin-repository.ts';
import { birthYear, type Archer, type ExportedMember } from '../domain/archer.ts';
import {
  planMemberListSync,
  type MemberChanges,
  type MemberImport,
  type MemberListRepository,
  type MemberListSummary,
} from '../domain/member-list.ts';
import type { Clock } from './ports/clock.ts';

export type MemberListStatus = { lastImport: MemberImport | null; activeMemberCount: number };

/** A member as the admin page lists them. */
export type ClubMember = { archer: Archer; category: AgeCategory; isAdmin: boolean };

export type UpdateMemberResult = { ok: true } | { ok: false; reason: 'not_found' | 'cannot_change_self' };

/** The club member list: imported from the FFTA export (admin page or command line), listed for admins. */
export class ClubMembers {
  readonly #members: MemberListRepository;
  readonly #admins: AdminRepository;
  readonly #clock: Clock;

  constructor(members: MemberListRepository, admins: AdminRepository, clock: Clock) {
    this.#members = members;
    this.#admins = admins;
    this.#clock = clock;
  }

  /** `importedBy`: licence number of the admin, `null` from the command line. */
  async import(exported: readonly ExportedMember[], importedBy: string | null): Promise<MemberListSummary> {
    return this.#members.sync((current) => planMemberListSync(current, exported), importedBy);
  }

  async status(): Promise<MemberListStatus> {
    const [lastImport, activeMemberCount] = await Promise.all([
      this.#members.lastImport(),
      this.#members.countActive(),
    ]);
    return { lastImport, activeMemberCount };
  }

  /** Everyone, members who left included, by name. The category is the one of the current season. */
  async list(): Promise<ClubMember[]> {
    const [archers, adminLicences] = await Promise.all([this.#members.all(), this.#admins.licenceNumbers()]);
    const admins = new Set(adminLicences);
    const today = this.#clock.today();
    return archers
      .map((archer) => ({
        archer,
        category: ageCategory(birthYear(archer), today),
        isAdmin: admins.has(archer.licenceNumber),
      }))
      .toSorted((a, b) => a.archer.fullName.localeCompare(b.archer.fullName, 'fr'));
  }

  /**
   * By hand: the state, for example a member who left before the next FFTA export (the next import sets it from the
   * file again), and whether the club pays their registrations (never touched by imports). An admin cannot change
   * themselves: deactivating would lose them the panel at once.
   */
  async update(by: Archer, licenceNumber: string, changes: MemberChanges): Promise<UpdateMemberResult> {
    if (licenceNumber === by.licenceNumber) return { ok: false, reason: 'cannot_change_self' };
    return (await this.#members.update(licenceNumber, changes)) ? { ok: true } : { ok: false, reason: 'not_found' };
  }
}
