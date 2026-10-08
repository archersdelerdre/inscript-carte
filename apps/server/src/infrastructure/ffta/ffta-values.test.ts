import { describe, expect, test } from 'bun:test';

import { parseFftaDates, splitFftaTitle } from './ffta-values.ts';

describe('parseFftaDates', () => {
  test('reads one day and the ranges the FFTA writes', () => {
    expect(parseFftaDates('Le 14 novembre 2026')).toEqual({ startDate: '2026-11-14', endDate: '2026-11-14' });
    expect(parseFftaDates('\n  Du 09 au 11 octobre 2026 ')).toEqual({ startDate: '2026-10-09', endDate: '2026-10-11' });
    expect(parseFftaDates('Du 31 octobre au 01 novembre 2026')).toEqual({
      startDate: '2026-10-31',
      endDate: '2026-11-01',
    });
    expect(parseFftaDates('Du 30 octobre 2026 au 02 mars 2027')).toEqual({
      startDate: '2026-10-30',
      endDate: '2027-03-02',
    });
  });

  test('puts a December start in the year before a January end', () => {
    expect(parseFftaDates('Du 30 décembre au 02 janvier 2027')).toEqual({
      startDate: '2026-12-30',
      endDate: '2027-01-02',
    });
  });

  test('refuses what it cannot read', () => {
    expect(parseFftaDates('Le 14 brumaire 2026')).toBeNull();
    expect(parseFftaDates('Bientôt')).toBeNull();
  });
});

describe('splitFftaTitle', () => {
  test('cuts at the last " à ", so a title may contain one too', () => {
    expect(splitFftaTitle('TIR À LA BUTTE à LA ROCHE SUR YON')).toEqual({
      title: 'TIR À LA BUTTE',
      town: 'LA ROCHE SUR YON',
    });
    expect(splitFftaTitle('CONCOURS à TOURS à SAINT-AVERTIN')).toEqual({
      title: 'CONCOURS à TOURS',
      town: 'SAINT-AVERTIN',
    });
    expect(splitFftaTitle('CONCOURS SANS VILLE')).toBeNull();
  });
});
