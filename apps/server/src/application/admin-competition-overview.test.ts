import { expect, test } from 'bun:test';

import type { Competition } from '../domain/competition.ts';
import { problemsOf } from './admin-competition-overview.ts';

const LINK = 'https://extranet.ffta.fr/new.pdf';

const competition = (overrides: Partial<Competition> = {}): Competition => ({
  id: '90001',
  title: 'Concours Salle',
  discipline: 'salle',
  status: 'scheduled',
  hasParaTir: false,
  hasFoamTargets: false,
  startDate: '2027-01-09',
  endDate: '2027-01-09',
  organizerClub: null,
  town: 'Nantes',
  departmentCode: '44',
  position: { latitude: 47.21, longitude: -1.55 },
  mandateUrl: LINK,
  mandateAddedOn: null,
  departures: [{ date: null, label: 'Matin', registrationOpens: null, shootingStarts: null }],
  prices: [{ audience: 'all', departures: 1, amountEuros: 10 }],
  missingSince: null,
  ...overrides,
});

test('a hidden competition says why: no place, gone from the FFTA list', () => {
  expect(problemsOf(competition({ position: null, missingSince: '2026-10-01', mandateUrl: null }), undefined)).toEqual([
    { kind: 'no_place' },
    { kind: 'missing', since: '2026-10-01' },
  ]);
});

test('a reading of an older link says nothing about the current mandate', () => {
  const old = { mandateUrl: 'https://extranet.ffta.fr/old.pdf', status: 'parsed' as const, attempts: 1, problems: [] };
  expect(problemsOf(competition(), old)).toEqual([{ kind: 'mandate_unread' }]);
  expect(problemsOf(competition(), undefined)).toEqual([{ kind: 'mandate_unread' }]);
});

test('a failed or refused reading gives its reasons, and whether it will be tried again', () => {
  const failed = {
    mandateUrl: LINK,
    status: 'failed' as const,
    attempts: 2,
    problems: ['Le mandat n’a pas pu être ouvert.'],
  };
  expect(problemsOf(competition({ departures: null, prices: null }), failed)).toEqual([
    { kind: 'mandate_failed', willRetry: true, details: ['Le mandat n’a pas pu être ouvert.'] },
  ]);
  expect(problemsOf(competition(), { ...failed, status: 'invalid', attempts: 3 })).toEqual([
    { kind: 'mandate_refused', willRetry: false, details: ['Le mandat n’a pas pu être ouvert.'] },
  ]);
});

test('a good reading without départs or prices is flagged; a complete one is not', () => {
  const parsed = { mandateUrl: LINK, status: 'parsed' as const, attempts: 1, problems: [] };
  expect(problemsOf(competition({ departures: null, prices: null }), parsed)).toEqual([
    { kind: 'mandate_without_departures' },
    { kind: 'mandate_without_prices' },
  ]);
  expect(problemsOf(competition(), parsed)).toEqual([]);
});
