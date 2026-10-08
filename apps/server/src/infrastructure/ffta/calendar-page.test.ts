import { describe, expect, test } from 'bun:test';

import { mergeParaTir, parseCalendarPage, type ListedCompetition } from './calendar-page.ts';

/** The FFTA card markup (www.ffta.fr/competitions, 2026-10), with made-up clubs. */
function card({
  id = '90001',
  head = 'valid',
  dates = 'Le 14 novembre 2026',
  title = 'CONCOURS SALLE à SAINT HERBLAIN',
  discipline = 'Tir à 18m',
  organizer = 'ARCHERS DE TEST <small>(NANTES)</small>',
  mandate = true,
} = {}): string {
  return `
    <article class="competition_item" style="--universColor: var(--cibles)">
      <div class="competition_item__head competition_item__head--${head}">
        <div class="competition_item__status"><div class="competition_item__dates">${dates}</div></div>
        <h2 class="competition_item__title">
          <a href="/index.php/epreuve/${id}"><div class="field field--name-label">${title}</div></a>
        </h2>
        <div class="competition_item__infos">
          <span><div class="field field--name-field-discipline">${discipline}</div></span>
          <span><div class="field field--name-field-type-championnat">Individuel</div></span>
          <span>${organizer}</span>
          <a class="btn" href="mailto:club@example.org" title="club@example.org">Mail</a>
          <a class="btn" href="https://example.org">Site</a>
        </div>
      </div>
      <div class="competition_item__actions">
        <span class="competition_item__pictos"></span>
        ${mandate ? `<a href="https://extranet.ffta.fr/medias/documents_epreuves/${id}.pdf" class="btn competition_item__mandat_btn">Mandat</a>` : ''}
        <a href="/index.php/epreuve/${id}" class="btn competition_item__infos_btn">Détail</a>
      </div>
    </article>`;
}

describe('parseCalendarPage', () => {
  test('reads every field of a card', () => {
    const { competitions, problems } = parseCalendarPage(card());
    expect(problems).toEqual([]);
    expect(competitions).toEqual([
      {
        fftaId: '90001',
        title: 'CONCOURS SALLE',
        town: 'SAINT HERBLAIN',
        startDate: '2026-11-14',
        endDate: '2026-11-14',
        status: 'scheduled',
        discipline: 'salle',
        hasParaTir: false,
        organizerClub: 'ARCHERS DE TEST',
        organizerEmail: 'club@example.org',
        mandateUrl: 'https://extranet.ffta.fr/medias/documents_epreuves/90001.pdf',
      },
    ]);
  });

  test('cuts the town at the last " à " and reads the status from the card head', () => {
    const { competitions } = parseCalendarPage(
      card({ title: 'TIR À LA BUTTE à LA ROCHE SUR YON', head: 'report' }) + card({ id: '90002', head: 'cancel' }),
    );
    expect(competitions.map(({ title, town, status }) => [title, town, status])).toEqual([
      ['TIR À LA BUTTE', 'LA ROCHE SUR YON', 'postponed'],
      ['CONCOURS SALLE', 'SAINT HERBLAIN', 'cancelled'],
    ]);
  });

  test('skips an unreadable card with a problem, and keeps reading the page', () => {
    const { competitions, problems } = parseCalendarPage(
      card({ discipline: 'Tir sous-marin' }) + card({ id: '90002', dates: 'Bientôt' }) + card({ id: '90003' }),
    );
    expect(competitions.map(({ fftaId }) => fftaId)).toEqual(['90003']);
    expect(problems).toEqual(['90001 : discipline inconnue : Tir sous-marin', '90002 : dates illisibles : Bientôt']);
  });

  test('marks Para-tir entries', () => {
    const { competitions } = parseCalendarPage(card({ discipline: "Para-tir à l'arc à 18m" }));
    expect(competitions[0]).toMatchObject({ discipline: 'salle', hasParaTir: true });
  });
});

const listed = (fftaId: string, overrides: Partial<ListedCompetition> = {}): ListedCompetition => ({
  fftaId,
  title: 'CONCOURS SALLE',
  town: 'SAINT HERBLAIN',
  startDate: '2026-11-14',
  endDate: '2026-11-14',
  status: 'scheduled',
  discipline: 'salle',
  hasParaTir: false,
  organizerClub: 'ARCHERS DE TEST',
  organizerEmail: null,
  mandateUrl: null,
  ...overrides,
});

describe('mergeParaTir', () => {
  test('turns the Para-tir entry of the same event into a flag, with its mandate when the main has none', () => {
    const merged = mergeParaTir([listed('1'), listed('2', { hasParaTir: true, mandateUrl: 'https://para.pdf' })]);
    expect(merged).toEqual([listed('1', { hasParaTir: true, mandateUrl: 'https://para.pdf' })]);
  });

  test('keeps a Para-tir entry with no main event, and never merges two main events', () => {
    const merged = mergeParaTir([
      listed('1'),
      listed('2'),
      listed('3', { hasParaTir: true, startDate: '2026-11-15', endDate: '2026-11-15' }),
    ]);
    expect(merged.map(({ fftaId, hasParaTir }) => [fftaId, hasParaTir])).toEqual([
      ['1', false],
      ['2', false],
      ['3', true],
    ]);
  });
});
