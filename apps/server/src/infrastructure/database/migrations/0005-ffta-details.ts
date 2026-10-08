import type { Knex } from 'knex';

/**
 * What the FFTA scraper reads on a competition's detail page, plus its bookkeeping. Legacy rows keep `NULL` until the
 * scraper reads them.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competitions', (table) => {
    /** "Individuel Tir à 18m 2027", "Uniquement Equipe …". */
    table.text('championship');
    table.boolean('has_duels');
    table.text('regional_committee');
    table.text('departmental_committee');
    table.text('organizer_phone');
    table.text('organizer_website');
    table.text('venue');
    /** One line per street line, separated by "\n". */
    table.text('street_lines');
    table.text('postal_code');
    table.text('city');
    table.text('country');
    /** The list card as last read: a change means the detail page is read again. */
    table.text('list_fingerprint');
    table.timestamp('detail_read_at');
    /** Last full run that saw it in the FFTA list. */
    table.timestamp('last_listed_at');
    /** Upcoming but gone from the FFTA list since this day; `NULL` while it is listed. */
    table.text('missing_since');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('competitions', (table) => {
    table.dropColumns(
      'championship',
      'has_duels',
      'regional_committee',
      'departmental_committee',
      'organizer_phone',
      'organizer_website',
      'venue',
      'street_lines',
      'postal_code',
      'city',
      'country',
      'list_fingerprint',
      'detail_read_at',
      'last_listed_at',
      'missing_since',
    );
  });
}
