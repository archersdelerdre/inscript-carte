import {
  ageCategory,
  type AgeCategory,
  type BowType,
  type Discipline,
  type MandateData,
  type PaymentMethod,
  type PaymentStatus,
  type RegistrationStatus,
  type Rhythm,
  type Sex,
} from '@inscript-carte/shared';

import { AdminAccounts } from '../../application/admin-accounts.ts';
import { addDays, toFrenchDate, type CalendarDate } from '../../domain/calendar-date.ts';
import { BunPasswordHasher } from '../bun-password-hasher.ts';
import { config } from '../config.ts';
import { SystemClock } from '../system-clock.ts';
import { createDatabase } from './connection.ts';
import { SqliteAdminRepository } from './sqlite-admin-repository.ts';
import { SqliteArcherRepository } from './sqlite-archer-repository.ts';

/**
 * Fills an empty development database with made-up data: members of every age, competitions of every kind around
 * Nantes (mandate readings included), and registrations in every status. Dates follow today, so the data never goes
 * stale. Never touches a database that already has competitions or members.
 */

const ADMIN_LICENCE = '0000001A';
const ADMIN_PASSWORD = 'demo-password-2026';
const YOUTH: AgeCategory[] = ['U11', 'U13', 'U15', 'U18', 'U21'];
const ADULTS: AgeCategory[] = ['S1', 'S2', 'S3'];

type DemoArcher = {
  licence: string;
  name: string;
  sex: Sex;
  birthDate: CalendarDate;
  isActive?: boolean;
  clubPays?: boolean;
};

const ARCHERS: DemoArcher[] = [
  { licence: ADMIN_LICENCE, name: 'ADMIN DEMO', sex: 'female', birthDate: '1980-01-01' },
  { licence: '0000002B', name: 'BERNARD LUCAS', sex: 'male', birthDate: '1972-06-14' },
  { licence: '0000003C', name: 'PETIT EMMA', sex: 'female', birthDate: '1995-03-22' },
  { licence: '0000004D', name: 'MOREAU HUGO', sex: 'male', birthDate: '2004-11-02' },
  { licence: '0000005E', name: 'LEROY CHLOE', sex: 'female', birthDate: '2009-08-30' },
  { licence: '0000006F', name: 'ROUX NATHAN', sex: 'male', birthDate: '2012-02-17', clubPays: true },
  { licence: '0000007G', name: 'FOURNIER LEA', sex: 'female', birthDate: '2014-05-09', clubPays: true },
  { licence: '0000008H', name: 'GIRARD TOM', sex: 'male', birthDate: '2016-09-25' },
  { licence: '0000009J', name: 'BONNET ALICE', sex: 'female', birthDate: '1958-12-04' },
  { licence: '0000010K', name: 'DUPUIS MARC', sex: 'male', birthDate: '1963-04-11' },
  { licence: '0000011L', name: 'LAMBERT JULIE', sex: 'female', birthDate: '1988-07-19' },
  { licence: '0000012M', name: 'FONTAINE PAUL', sex: 'male', birthDate: '1999-01-28' },
  { licence: '0000013N', name: 'CHEVALIER INES', sex: 'female', birthDate: '2007-10-06' },
  { licence: '0000014P', name: 'ROBIN LOUIS', sex: 'male', birthDate: '1979-03-15' },
  { licence: '0000015Q', name: 'MASSON CLARA', sex: 'female', birthDate: '1969-05-27' },
  { licence: '0000016R', name: 'ANCIEN ARCHER', sex: 'male', birthDate: '1975-02-02', isActive: false },
];

type DemoCompetition = {
  id: string;
  title: string;
  discipline: Discipline;
  /** Days from today to the first day. */
  startsIn: number;
  days?: number;
  town: string;
  department: string;
  /** `null`: no place found, hidden from the public. */
  position: [number, number] | null;
  status?: 'scheduled' | 'postponed' | 'cancelled';
  paraTir?: boolean;
  foamTargets?: boolean;
  /** `true`: a mandate link, read by the LLM (`reading`); `'unread'`: a link nobody could read yet. */
  mandate?: true | 'unread';
  /** Days before the start the mandate appeared; 60 when not given (an early mandate). */
  mandateDaysBefore?: number;
  /** `byDay`: each rhythm for its own day ("samedi en AB, dimanche en AB/CD"); otherwise a choice ("AB/CD ou ABC"). */
  reading?: { departures: number; rhythms?: Rhythm[]; byDay?: boolean; prices?: 'standard' | 'none' } | 'invalid';
};

const COMPETITIONS: DemoCompetition[] = [
  // Loire-Atlantique, the club's département.
  {
    id: '90001',
    title: 'TIR EN SALLE 18M DE CARQUEFOU',
    discipline: 'salle',
    startsIn: 30,
    days: 2,
    town: 'CARQUEFOU',
    department: '44',
    position: [47.2975, -1.4914],
    paraTir: true,
    mandate: true,
    reading: { departures: 4, rhythms: ['AB', 'AB/CD'], byDay: true },
  },
  {
    id: '90002',
    title: 'CONCOURS SALLE NANTES ERDRE',
    discipline: 'salle',
    startsIn: 23,
    town: 'NANTES',
    department: '44',
    position: [47.2184, -1.5536],
    mandate: true,
    reading: { departures: 2, rhythms: ['AB'] },
  },
  {
    id: '90003',
    title: 'SALLE JEUNES CIBLES MOUSSES',
    discipline: 'salle',
    startsIn: 44,
    town: 'REZE',
    department: '44',
    position: [47.1833, -1.55],
    foamTargets: true,
    mandate: true,
    reading: { departures: 2, rhythms: ['AB'] },
  },
  {
    id: '90004',
    title: 'TIR À 18M SAINT-HERBLAIN',
    discipline: 'salle',
    startsIn: 58,
    days: 2,
    town: 'SAINT-HERBLAIN',
    department: '44',
    position: [47.2122, -1.6497],
    mandate: true,
    reading: { departures: 3, rhythms: [] },
  },
  {
    id: '90005',
    title: 'SALLE ORVAULT',
    discipline: 'salle',
    startsIn: 12,
    town: 'ORVAULT',
    department: '44',
    position: [47.2711, -1.6225],
    mandate: true,
    mandateDaysBefore: 11,
    reading: { departures: 2, rhythms: ['AB'] },
  },
  {
    id: '90006',
    title: 'CONCOURS FITA GUERANDE',
    discipline: 'exterieur',
    startsIn: 120,
    days: 2,
    town: 'GUERANDE',
    department: '44',
    position: [47.3281, -2.4292],
    paraTir: true,
    mandate: true,
    reading: { departures: 3, rhythms: ['ABC'] },
  },
  {
    id: '90007',
    title: 'TIR EXTÉRIEUR ANCENIS',
    discipline: 'exterieur',
    startsIn: 135,
    town: 'ANCENIS',
    department: '44',
    position: [47.3656, -1.1772],
  },
  {
    id: '90008',
    title: 'CAMPAGNE DE CLISSON',
    discipline: 'campagne',
    startsIn: 95,
    town: 'CLISSON',
    department: '44',
    position: [47.0867, -1.2817],
    mandate: true,
    reading: { departures: 1 },
  },
  {
    id: '90009',
    title: 'PARCOURS 3D CHÂTEAUBRIANT',
    discipline: '3d',
    startsIn: 75,
    town: 'CHATEAUBRIANT',
    department: '44',
    position: [47.7172, -1.3761],
    mandate: 'unread',
  },
  {
    id: '90010',
    title: 'TIR NATURE PORNIC',
    discipline: 'nature',
    startsIn: 150,
    town: 'PORNIC',
    department: '44',
    position: [47.1153, -2.1039],
  },
  {
    id: '90011',
    title: 'BEURSAULT BLAIN',
    discipline: 'beursault',
    startsIn: 110,
    town: 'BLAIN',
    department: '44',
    position: [47.4764, -1.7631],
  },
  {
    id: '90012',
    title: 'CONCOURS LOISIRS SAINT-NAZAIRE',
    discipline: 'loisirs',
    startsIn: 40,
    town: 'SAINT-NAZAIRE',
    department: '44',
    position: [47.2735, -2.2138],
  },
  {
    id: '90013',
    title: 'TIR DU ROY LA BAULE',
    discipline: 'autres',
    startsIn: 160,
    town: 'LA BAULE-ESCOUBLAC',
    department: '44',
    position: [47.2864, -2.3906],
  },
  {
    id: '90014',
    title: 'SALLE DE LA SAINT-NICOLAS (REPORTÉ)',
    discipline: 'salle',
    startsIn: 65,
    town: 'NANTES',
    department: '44',
    position: [47.2184, -1.5536],
    status: 'postponed',
    mandate: true,
    reading: 'invalid',
  },
  {
    id: '90015',
    title: 'SALLE ANNULÉE',
    discipline: 'salle',
    startsIn: 35,
    town: 'CARQUEFOU',
    department: '44',
    position: [47.2975, -1.4914],
    status: 'cancelled',
  },
  {
    id: '90016',
    title: 'CONCOURS SANS LIEU CONNU',
    discipline: 'salle',
    startsIn: 50,
    town: 'LIEU-DIT INCONNU',
    department: '44',
    position: null,
  },
  {
    id: '90017',
    title: 'SALLE DE NOËL (TERMINÉ)',
    discipline: 'salle',
    startsIn: -12,
    town: 'NANTES',
    department: '44',
    position: [47.2184, -1.5536],
    mandate: true,
    reading: { departures: 2, rhythms: ['AB'] },
  },
  // Nearby départements.
  {
    id: '90018',
    title: 'CHAMPIONNAT DÉPARTEMENTAL SALLE RENNES',
    discipline: 'salle',
    startsIn: 52,
    days: 2,
    town: 'RENNES',
    department: '35',
    position: [48.1173, -1.6778],
    mandate: true,
    reading: { departures: 4, rhythms: ['AB/CD', 'ABC'] },
  },
  {
    id: '90019',
    title: 'TIR EN SALLE ANGERS',
    discipline: 'salle',
    startsIn: 37,
    town: 'ANGERS',
    department: '49',
    position: [47.4784, -0.5632],
    mandate: true,
    reading: { departures: 2, rhythms: ['AB'], prices: 'none' },
  },
  {
    id: '90020',
    title: 'FITA CHOLET',
    discipline: 'exterieur',
    startsIn: 128,
    days: 2,
    town: 'CHOLET',
    department: '49',
    position: [47.06, -0.8786],
    mandate: true,
    reading: { departures: 2, rhythms: ['AB/CD'] },
  },
  {
    id: '90021',
    title: 'CONCOURS SALLE VANNES',
    discipline: 'salle',
    startsIn: 66,
    town: 'VANNES',
    department: '56',
    position: [47.6582, -2.7608],
    foamTargets: true,
  },
  {
    id: '90022',
    title: '3D DE LA ROCHE-SUR-YON',
    discipline: '3d',
    startsIn: 88,
    town: 'LA ROCHE-SUR-YON',
    department: '85',
    position: [46.6705, -1.426],
  },
  {
    id: '90023',
    title: 'CONCOURS LES SABLES',
    discipline: 'salle',
    startsIn: 27,
    days: 2,
    town: "LES SABLES-D'OLONNE",
    department: '85',
    position: [46.4967, -1.7831],
    mandate: true,
    reading: { departures: 3, rhythms: ['AB'] },
  },
  {
    id: '90024',
    title: 'TIR À 18M LE MANS',
    discipline: 'salle',
    startsIn: 20,
    town: 'LE MANS',
    department: '72',
    position: [48.0061, 0.1996],
  },
];

type DemoRegistration = {
  competition: string;
  archer: string;
  departures: number[];
  bow?: BowType;
  status?: RegistrationStatus;
  payment?: PaymentStatus;
  /** `null` for a member the club pays for: no payment method asked. */
  method?: PaymentMethod | null;
  carpool?: boolean;
  /** Cancelled by the archer: the note the app writes then. */
  note?: 'withdrawn';
};

const REGISTRATIONS: DemoRegistration[] = [
  // Carquefou: every step of the club's work.
  { competition: '90001', archer: ADMIN_LICENCE, departures: [1, 3], carpool: true },
  {
    competition: '90001',
    archer: '0000002B',
    departures: [2],
    bow: 'poulies',
    status: 'sent_to_organizer',
    payment: 'paid',
    method: 'transfer',
  },
  { competition: '90001', archer: '0000003C', departures: [1], status: 'confirmed', payment: 'paid', method: 'cheque' },
  { competition: '90001', archer: '0000006F', departures: [1, 2], payment: 'nothing_due', method: null },
  {
    competition: '90001',
    archer: '0000009J',
    departures: [4],
    bow: 'arc_nu',
    status: 'full',
    payment: 'to_refund',
    method: 'cash',
  },
  {
    competition: '90001',
    archer: '0000011L',
    departures: [3],
    status: 'cancelled',
    payment: 'nothing_due',
    method: 'cash',
    note: 'withdrawn',
  },
  // Nantes: to send and to pay.
  { competition: '90002', archer: '0000004D', departures: [1], carpool: true },
  { competition: '90002', archer: '0000012M', departures: [1, 2], bow: 'poulies', method: 'transfer' },
  { competition: '90002', archer: '0000014P', departures: [2], status: 'sent_to_organizer', method: 'cheque' },
  // Rezé (cibles mousses): the young ones.
  { competition: '90003', archer: '0000007G', departures: [1], payment: 'nothing_due', method: null },
  { competition: '90003', archer: '0000008H', departures: [1] },
  { competition: '90003', archer: '0000005E', departures: [2], status: 'confirmed', payment: 'paid', method: 'cash' },
  // Orvault: club deadline over, everything settled.
  { competition: '90005', archer: '0000010K', departures: [1], status: 'confirmed', payment: 'paid', method: 'cheque' },
  {
    competition: '90005',
    archer: '0000015Q',
    departures: [2],
    status: 'full',
    payment: 'refunded',
    method: 'transfer',
  },
  // Guérande (extérieur): distances.
  { competition: '90006', archer: '0000013N', departures: [1, 2], carpool: true },
  { competition: '90006', archer: '0000002B', departures: [3], bow: 'poulies', payment: 'paid', method: 'transfer' },
  // Rennes, Angers: further away.
  {
    competition: '90018',
    archer: '0000003C',
    departures: [2],
    status: 'sent_to_organizer',
    payment: 'paid',
    method: 'cheque',
  },
  { competition: '90019', archer: '0000014P', departures: [1] },
  // A finished competition.
  {
    competition: '90017',
    archer: ADMIN_LICENCE,
    departures: [1],
    status: 'confirmed',
    payment: 'paid',
    method: 'cash',
  },
  { competition: '90017', archer: '0000010K', departures: [2], status: 'confirmed', payment: 'paid', method: 'cheque' },
];

function mandateData(
  reading: Exclude<DemoCompetition['reading'], 'invalid' | undefined>,
  start: CalendarDate,
  days: number,
): MandateData {
  const departures = Array.from({ length: reading.departures }, (_, index) => {
    const day = days > 1 ? Math.min(Math.floor(index / 2), days - 1) : 0;
    const morning = index % 2 === 0;
    return {
      date: addDays(start, day),
      // Dates follow today, so no weekday in the name.
      label: morning ? 'Matin' : 'Après-midi',
      registrationOpens: morning ? '08:30' : '13:30',
      shootingStarts: morning ? '09:15' : '14:15',
    };
  });
  const prices =
    reading.prices === 'none'
      ? []
      : [
          { categories: YOUTH, departures: 1, amountEuros: 8 },
          { categories: YOUTH, departures: 2, amountEuros: 14 },
          { categories: ADULTS, departures: 1, amountEuros: 12 },
          { categories: ADULTS, departures: 2, amountEuros: 20 },
          { categories: ['U11'] satisfies AgeCategory[], departures: 1, amountEuros: 6 },
        ];
  return {
    departures,
    prices: prices.filter((price) => price.departures <= Math.max(reading.departures, 1)),
    foamTargets: 'not_mentioned',
    rhythms: reading.rhythms ?? [],
    rhythmsAreAlternatives: !reading.byDay && (reading.rhythms?.length ?? 0) > 1,
    evidence: {
      departures: 'Greffe 30 min avant le tir (données de démonstration)',
      prices: reading.prices === 'none' ? null : 'Jeunes 8 €, adultes 12 € (données de démonstration)',
      foamTargets: null,
      rhythm: reading.rhythms?.length
        ? `Rythme ${reading.rhythms.join(reading.byDay ? ' le premier jour, ' : ' ou ')}${reading.byDay ? ' le second' : ''}`
        : null,
    },
  };
}

const database = createDatabase(config.databasePath);
try {
  await database.migrate.latest();
  const [{ competitions }] = (await database('competitions').count({ competitions: '*' })) as [
    { competitions: number },
  ];
  const [{ archers }] = (await database('archers').count({ archers: '*' })) as [{ archers: number }];
  if (competitions > 0 || archers > 0) {
    console.log('The database already has data: nothing added. Delete it first to start over.');
  } else {
    await seed();
  }
} finally {
  await database.destroy();
}

async function seed(): Promise<void> {
  const today = new SystemClock().today();
  const birthYearOf = new Map(ARCHERS.map((archer) => [archer.licence, Number(archer.birthDate.slice(0, 4))]));
  const startOf = new Map<string, CalendarDate>();

  await database.transaction(async (transaction) => {
    await transaction('archers').insert(
      ARCHERS.map((archer) => ({
        licence_number: archer.licence,
        full_name: archer.name,
        sex: archer.sex,
        birth_date: archer.birthDate,
        is_active: archer.isActive ?? true,
        club_pays_registrations: archer.clubPays ?? false,
        ...(archer.licence === ADMIN_LICENCE ? { email: 'admin.demo@example.org', phone: '06 00 00 00 00' } : {}),
      })),
    );

    for (const competition of COMPETITIONS) {
      const start = addDays(today, competition.startsIn);
      startOf.set(competition.id, start);
      const mandateUrl = competition.mandate ? `https://www.ffta.fr/demo/mandat-${competition.id}.pdf` : null;
      // One row at a time: SQLite refuses a multi-row insert when a row leaves `has_para_tir` out.
      await transaction('competitions').insert({
        ffta_id: competition.id,
        title: competition.title,
        discipline: competition.discipline,
        status: competition.status ?? 'scheduled',
        start_date: start,
        end_date: addDays(start, (competition.days ?? 1) - 1),
        organizer_club: 'CLUB DE DÉMONSTRATION',
        organizer_email: 'organisateur@example.org',
        town: competition.town,
        department_code: competition.department,
        latitude: competition.position?.[0] ?? null,
        longitude: competition.position?.[1] ?? null,
        has_para_tir: competition.paraTir ?? false,
        has_foam_targets: competition.foamTargets ?? false,
        mandate_url: mandateUrl,
        mandate_added_on: mandateUrl ? addDays(start, -(competition.mandateDaysBefore ?? 60)) : null,
        last_listed_at: transaction.fn.now(),
      });
      if (!mandateUrl || !competition.reading) continue;
      const reading = competition.reading;
      await transaction('competition_mandates').insert({
        ffta_id: competition.id,
        mandate_url: mandateUrl,
        status: reading === 'invalid' ? 'invalid' : 'parsed',
        attempts: 1,
        data:
          reading === 'invalid'
            ? JSON.stringify(mandateData({ departures: 0 }, start, 1))
            : JSON.stringify(mandateData(reading, start, competition.days ?? 1)),
        problems:
          reading === 'invalid' ? JSON.stringify(['Aucun départ du mandat ne tombe un jour du concours.']) : null,
        model: 'demo',
        cost_usd: 0,
        page_count: 2,
        read_at: transaction.fn.now(),
      });
    }

    const references = new Map<string, string>();
    for (const registration of REGISTRATIONS) {
      const key = `${registration.competition}|${registration.archer}`;
      const reference = references.get(key) ?? `R-${String(references.size + 1).padStart(4, '0')}`;
      references.set(key, reference);
      const start = startOf.get(registration.competition)!;
      const discipline = COMPETITIONS.find(({ id }) => id === registration.competition)!.discipline;
      const status = registration.status ?? 'received';
      await transaction('registrations').insert(
        registration.departures.map((departure) => ({
          competition_ffta_id: registration.competition,
          archer_licence_number: registration.archer,
          departure,
          bow_type: registration.bow ?? 'classique',
          category: ageCategory(birthYearOf.get(registration.archer)!, start),
          trispot: false,
          distance: discipline === 'exterieur' ? 'nationales' : null,
          status,
          payment_status: registration.payment ?? 'to_pay',
          payment_method: registration.method === undefined ? 'cash' : registration.method,
          payment_reference: reference,
          carpool: registration.carpool ?? false,
          club_note: registration.note === 'withdrawn' ? `Retirée par l'archer le ${toFrenchDate(today)}` : null,
          cancelled_at: status === 'cancelled' ? today : null,
          updated_by: status === 'received' ? null : ADMIN_LICENCE,
        })),
      );
    }
  });

  const admins = new AdminAccounts(
    new SqliteArcherRepository(database),
    new SqliteAdminRepository(database),
    new BunPasswordHasher(),
  );
  await admins.setPassword(ADMIN_LICENCE, ADMIN_PASSWORD);

  console.log(
    `Demo data added: ${ARCHERS.length} members, ${COMPETITIONS.length} competitions, ` +
      `${REGISTRATIONS.reduce((total, { departures }) => total + departures.length, 0)} registrations.`,
  );
  console.log(`Sign in: licence ${ADMIN_LICENCE}, birth date 01/01/1980, admin password ${ADMIN_PASSWORD}.`);
}
