import { DEPARTMENT_NAMES } from '@inscript-carte/shared';

/** Upper case, no accents, every other sign a space: "Val-d'Oise" and "VAL D'OISE" both become "VAL D OISE". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const NORMALIZED_NAMES = Object.entries(DEPARTMENT_NAMES).map(([code, name]) => ({ code, words: normalize(name) }));

/**
 * The département of a French postal code: its first two digits, three overseas (97x, 988), and Corsica's 20xxx
 * split in two (below 20200 Corse-du-Sud). `null` for a code no département has (Monaco, abroad).
 */
export function departmentFromPostalCode(postalCode: string): string | null {
  if (!/^\d{5}$/.test(postalCode)) return null;
  let code = postalCode.slice(0, 2);
  if (code === '97' || code === '98') code = postalCode.slice(0, 3);
  if (code === '20') code = Number(postalCode) < 20200 ? '2A' : '2B';
  return DEPARTMENT_NAMES[code] ? code : null;
}

/**
 * The département a departmental committee is named after: "COMITE DEPARTEMENTAL DE LA HAUTE LOIRE", "C.D. TIR A
 * L'ARC ESSONNE". The longest name found wins, so "Haute-Loire" beats "Loire" and "Lot-et-Garonne" beats "Lot".
 */
export function departmentFromCommittee(committee: string): string | null {
  const words = ` ${normalize(committee)} `;
  let best: { code: string; words: string } | null = null;
  for (const name of NORMALIZED_NAMES) {
    if (words.includes(` ${name.words} `) && name.words.length > (best?.words.length ?? 0)) best = name;
  }
  return best?.code ?? null;
}

/**
 * Only overseas, where a region is one département ("COMITE REGIONAL DE LA MARTINIQUE" → 972). Elsewhere a region's
 * name can hold a département's ("PAYS DE LA LOIRE" is not the Loire): never read from it.
 */
export function departmentFromRegionalCommittee(committee: string): string | null {
  const code = departmentFromCommittee(committee);
  return code && code.length === 3 ? code : null;
}
