import type { Archer } from '../domain/archer.ts';
import {
  planMemberListSync,
  type MemberImport,
  type MemberListRepository,
  type MemberListSummary,
} from '../domain/member-list.ts';

export type MemberListStatus = { lastImport: MemberImport | null; activeMemberCount: number };

/** Replaces the member list with a new FFTA export, from the admin panel or the command line. */
export class MemberListImport {
  readonly #members: MemberListRepository;

  constructor(members: MemberListRepository) {
    this.#members = members;
  }

  /** `importedBy`: licence number of the admin, `null` from the command line. */
  async execute(exported: readonly Archer[], importedBy: string | null): Promise<MemberListSummary> {
    return this.#members.sync((current) => planMemberListSync(current, exported), importedBy);
  }

  async status(): Promise<MemberListStatus> {
    const [lastImport, activeMemberCount] = await Promise.all([
      this.#members.lastImport(),
      this.#members.countActive(),
    ]);
    return { lastImport, activeMemberCount };
  }
}
