import { describe, expect, test } from 'bun:test';

import { parseCompetitionPage } from './competition-page.ts';

/** The FFTA detail markup (www.ffta.fr/epreuve/<id>, 2026-10), with a made-up club and place. */
function page({
  status = 'valid',
  departmentalCommittee = 'COMITE DEPARTEMENTAL LOIRE ATLANTIQUE',
  place = `
    <p><strong>GYMNASE DES TESTS</strong></p>
    <p>12 RUE DE L'EXEMPLE</p>
    <p>44800 SAINT HERBLAIN</p>
    <p>FRANCE</p>
    <br><a class="btn" href="https://www.google.com/maps/dir/?api=1&amp;destination=47.2121,-1.6500">Itinéraire Google</a>`,
  links = `
    <div>Tel <a class="btn" href="tel:0200000000">0200000000</a></div>
    <div>Mail <a class="btn" href="mailto:club@example.org">club@example.org</a></div>
    <div>Site <a class="btn" href="https://example.org">https://example.org</a></div>`,
} = {}): string {
  return `
    <h1 class="page-title"><div class="field field--name-label">CONCOURS SALLE à SAINT HERBLAIN</div></h1>
    <article class="competition_detail">
      <div class="competition_detail__status">
        <div class="competition_detail__dates">Du 31 octobre au 01 novembre 2026</div>
        <span class="competition_detail__badge status--${status}">Validée</span>
      </div>
      <div class="competition_detail__actions">
        <a href="https://extranet.ffta.fr/medias/documents_epreuves/90001.pdf" class="btn competition_detail__mandat_btn">Mandat</a>
      </div>
      <div class="competition_detail__infos"><div class="row">
        <div class="col-md-6">
          <p>Discipline : <strong>Tir à 18m</strong></p>
          <p>Championnat : <strong>Individuel Tir à 18m 2027</strong></p>
          <p>Duels : <strong>Non</strong></p>
          <p>Comité régional : <strong>COMITE REGIONAL DES PAYS DE LA LOIRE</strong></p>
          ${departmentalCommittee ? `<p>Comité départemental : <strong>${departmentalCommittee}</strong></p>` : ''}
        </div>
        <div class="col-md-6">
          <p>Organisateur : <strong>ARCHERS DE TEST</strong></p>
          <p>Lieu : <strong>SAINT HERBLAIN</strong></p>
          ${place}
        </div>
      </div></div>
      <div class="competition_detail__links">${links}</div>
    </article>`;
}

describe('parseCompetitionPage', () => {
  test('reads every field of the page', () => {
    const { detail, problems } = parseCompetitionPage('90001', page());
    expect(problems).toEqual([]);
    expect(detail).toEqual({
      fftaId: '90001',
      title: 'CONCOURS SALLE',
      town: 'SAINT HERBLAIN',
      startDate: '2026-10-31',
      endDate: '2026-11-01',
      status: 'scheduled',
      discipline: 'salle',
      hasParaTir: false,
      championship: 'Individuel Tir à 18m 2027',
      hasDuels: false,
      regionalCommittee: 'COMITE REGIONAL DES PAYS DE LA LOIRE',
      departmentalCommittee: 'COMITE DEPARTEMENTAL LOIRE ATLANTIQUE',
      organizerClub: 'ARCHERS DE TEST',
      venue: 'GYMNASE DES TESTS',
      streetLines: ["12 RUE DE L'EXEMPLE"],
      postalCode: '44800',
      city: 'SAINT HERBLAIN',
      country: 'FRANCE',
      departmentCode: '44',
      phone: '0200000000',
      email: 'club@example.org',
      website: 'https://example.org',
      mandateUrl: 'https://extranet.ffta.fr/medias/documents_epreuves/90001.pdf',
    });
  });

  test("takes the venue's postal code over the committee: a club may shoot across the border", () => {
    const { detail } = parseCompetitionPage('90001', page({ departmentalCommittee: 'COMITE DEPARTEMENTAL VENDEE' }));
    expect(detail?.departmentCode).toBe('44');
  });

  test('falls back to the committee when the page has no address, and keeps going without contacts', () => {
    const { detail } = parseCompetitionPage('90001', page({ place: '', links: '' }));
    expect(detail).toMatchObject({
      venue: null,
      streetLines: [],
      postalCode: null,
      departmentCode: '44',
      phone: null,
      email: null,
      website: null,
    });
  });

  test('gives no département abroad, and reads the status badge', () => {
    const { detail } = parseCompetitionPage(
      '90001',
      page({ status: 'cancel', departmentalCommittee: '', place: '<p>WROCLAW - POLOGNE</p>' }),
    );
    expect(detail).toMatchObject({ departmentCode: null, status: 'cancelled', streetLines: ['WROCLAW - POLOGNE'] });
  });

  test('reports a page that is not a competition', () => {
    expect(parseCompetitionPage('90001', '<h1>Page introuvable</h1>')).toEqual({
      detail: null,
      problems: ['90001 : page sans fiche de compétition'],
    });
  });
});
