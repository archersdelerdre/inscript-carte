import {
  COMPETITION_STATUS_LABELS,
  DEPARTMENT_NAMES,
  DISCIPLINE_LABELS,
  type CompetitionFields,
  type CompetitionOverridesRequest,
  type GeoPosition,
  type MandateAudience,
} from '@inscript-carte/shared';

import { formatDateRange, formatDay } from '@/lib/dates';

export const AUDIENCE_LABELS: Record<MandateAudience, string> = {
  adult: 'Adultes',
  youth: 'Jeunes (U11 à U21)',
  all: 'Tous',
};

export const MAX_DEPARTURES = 12;

/** A row being edited: everything is text, the way inputs hold it. `key` only identifies the row in React. */
export type DepartureRow = {
  key: number;
  label: string;
  date: string;
  registrationOpens: string;
  shootingStarts: string;
};

export type PriceRow = { key: number; audience: MandateAudience; departures: string; amount: string };

export type FormState = Omit<CompetitionFields, 'mandateUrl' | 'departures' | 'prices'> & {
  mandateUrl: string;
  departures: DepartureRow[];
  prices: PriceRow[];
};

let lastKey = 0;
export function nextRowKey(): number {
  lastKey += 1;
  return lastKey;
}

export function fieldsToForm(fields: CompetitionFields): FormState {
  return {
    ...fields,
    mandateUrl: fields.mandateUrl ?? '',
    departures: (fields.departures ?? []).map((departure) => ({
      key: nextRowKey(),
      label: departure.label,
      date: departure.date ?? '',
      registrationOpens: departure.registrationOpens ?? '',
      shootingStarts: departure.shootingStarts ?? '',
    })),
    prices: (fields.prices ?? []).map((price) => ({
      key: nextRowKey(),
      audience: price.audience,
      departures: String(price.departures),
      amount: String(price.amountEuros),
    })),
  };
}

/** Same shape for the form and for FFTA's values, so that equal values give equal JSON, whatever the key order. */
export function normalize(fields: CompetitionFields): CompetitionFields {
  return {
    title: fields.title.trim(),
    startDate: fields.startDate,
    endDate: fields.endDate,
    discipline: fields.discipline,
    status: fields.status,
    hasParaTir: fields.hasParaTir,
    hasFoamTargets: fields.hasFoamTargets,
    mandateUrl: fields.mandateUrl?.trim() || null,
    town: fields.town.trim(),
    departmentCode: fields.departmentCode,
    position: fields.position && { latitude: fields.position.latitude, longitude: fields.position.longitude },
    departures: fields.departures?.length
      ? fields.departures.map((departure) => ({
          date: departure.date || null,
          label: departure.label.trim(),
          registrationOpens: departure.registrationOpens || null,
          shootingStarts: departure.shootingStarts || null,
        }))
      : null,
    prices: fields.prices?.length
      ? fields.prices.map((price) => ({
          audience: price.audience,
          departures: price.departures,
          amountEuros: price.amountEuros,
        }))
      : null,
  };
}

export function formToFields(form: FormState): CompetitionFields {
  return normalize({
    ...form,
    mandateUrl: form.mandateUrl,
    departures: form.departures.map((row) => ({
      date: row.date,
      label: row.label,
      registrationOpens: row.registrationOpens,
      shootingStarts: row.shootingStarts,
    })),
    prices: form.prices.map((row) => ({
      audience: row.audience,
      departures: row.departures.trim() === '' ? Number.NaN : Number(row.departures),
      amountEuros: row.amount.trim() === '' ? Number.NaN : Number(row.amount),
    })),
  });
}

type FieldKey = keyof CompetitionFields;

/** Fields whose form value is not FFTA's. `mandateUrl` and `position` cannot be edited to nothing: empty is "not edited". */
export function editedKeys(form: FormState, ffta: CompetitionFields): FieldKey[] {
  const current = formToFields(form);
  const original = normalize(ffta);
  return (Object.keys(original) as FieldKey[]).filter((key) => {
    if ((key === 'mandateUrl' || key === 'position') && current[key] === null) return false;
    return JSON.stringify(current[key]) !== JSON.stringify(original[key]);
  });
}

/** Only the edited fields. A list emptied on purpose goes as `[]`, which means "none". */
export function buildRequest(form: FormState, ffta: CompetitionFields): CompetitionOverridesRequest {
  const current = formToFields(form);
  const request: Record<string, unknown> = {};
  for (const key of editedKeys(form, ffta)) {
    request[key] = (key === 'departures' || key === 'prices') && current[key] === null ? [] : current[key];
  }
  return request as CompetitionOverridesRequest;
}

export function isDirty(form: FormState, initial: CompetitionFields): boolean {
  return JSON.stringify(formToFields(form)) !== JSON.stringify(normalize(initial));
}

export type FormErrors = {
  title?: string;
  dates?: string;
  town?: string;
  mandateUrl?: string;
  departures?: string;
  prices?: string;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Mirrors the server's limits, for the fields that would be sent. */
export function validate(form: FormState, edited: readonly FieldKey[]): FormErrors {
  const errors: FormErrors = {};
  const fields = formToFields(form);
  const has = (key: FieldKey) => edited.includes(key);

  if (has('title')) {
    if (!fields.title) errors.title = 'Indiquez le titre du concours.';
    else if (fields.title.length > 200) errors.title = 'Le titre ne peut pas dépasser 200 caractères.';
  }
  if (has('town')) {
    if (!fields.town) errors.town = 'Indiquez la ville.';
    else if (fields.town.length > 200) errors.town = 'Le nom de la ville ne peut pas dépasser 200 caractères.';
  }
  const datesEdited = has('startDate') || has('endDate');
  if (datesEdited) {
    if (!fields.startDate || !fields.endDate) errors.dates = 'Indiquez la date de début et la date de fin.';
    else if (fields.endDate < fields.startDate) errors.dates = 'La date de fin ne peut pas précéder la date de début.';
  }
  if (form.mandateUrl.trim() && !form.mandateUrl.trim().startsWith('https://')) {
    errors.mandateUrl = 'Le lien doit commencer par « https:// ».';
  }

  if (has('departures') || datesEdited) {
    const rows = fields.departures ?? [];
    if (rows.length > MAX_DEPARTURES) {
      errors.departures = `Un concours ne peut pas avoir plus de ${MAX_DEPARTURES} départs.`;
    } else if (rows.some((row) => !row.label)) {
      errors.departures = 'Chaque départ doit avoir un nom.';
    } else if (rows.some((row) => row.label.length > 80)) {
      errors.departures = 'Le nom d’un départ ne peut pas dépasser 80 caractères.';
    } else if (
      rows.some(
        (row) =>
          (row.registrationOpens && !TIME.test(row.registrationOpens)) ||
          (row.shootingStarts && !TIME.test(row.shootingStarts)),
      )
    ) {
      errors.departures = 'Les heures doivent être écrites sous la forme 09:30.';
    } else if (
      !errors.dates &&
      rows.some((row) => row.date && (row.date < fields.startDate || row.date > fields.endDate))
    ) {
      errors.departures = 'La date d’un départ doit tomber pendant le concours.';
    }
  }

  if (has('prices')) {
    const rows = fields.prices ?? [];
    const amounts = new Map<string, number>();
    let duplicate = false;
    for (const row of rows) {
      const key = `${row.audience}:${row.departures}`;
      const known = amounts.get(key);
      if (known !== undefined && known !== row.amountEuros) duplicate = true;
      amounts.set(key, row.amountEuros);
    }
    if (
      rows.some((row) => !Number.isInteger(row.departures) || row.departures < 1 || row.departures > MAX_DEPARTURES)
    ) {
      errors.prices = `Le nombre de départs d’un tarif doit être compris entre 1 et ${MAX_DEPARTURES}.`;
    } else if (rows.some((row) => !(row.amountEuros >= 0 && row.amountEuros <= 150))) {
      errors.prices = 'Le montant d’un tarif doit être compris entre 0 et 150 €.';
    } else if (duplicate) {
      errors.prices = 'Un même public et un même nombre de départs ne peuvent pas avoir deux montants différents.';
    }
  }
  return errors;
}

export function departmentOptions(current: string): { code: string; label: string }[] {
  const codes = Object.keys(DEPARTMENT_NAMES);
  if (!codes.includes(current)) codes.push(current);
  return codes
    .toSorted((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
    .map((code) => ({ code, label: `${code} - ${DEPARTMENT_NAMES[code] ?? code}` }));
}

export function formatPosition(position: GeoPosition): string {
  return `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}`;
}

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** FFTA's value of a field, in words, for « Valeur FFTA : … ». */
export function describeFfta(key: FieldKey | 'dates', ffta: CompetitionFields): string {
  switch (key) {
    case 'title':
      return ffta.title;
    case 'dates':
      return formatDateRange(ffta.startDate, ffta.endDate);
    case 'startDate':
      return formatDay(ffta.startDate);
    case 'endDate':
      return formatDay(ffta.endDate);
    case 'discipline':
      return DISCIPLINE_LABELS[ffta.discipline];
    case 'status':
      return COMPETITION_STATUS_LABELS[ffta.status];
    case 'hasParaTir':
      return ffta.hasParaTir ? 'oui' : 'non';
    case 'hasFoamTargets':
      return ffta.hasFoamTargets ? 'oui' : 'non';
    case 'mandateUrl':
      return ffta.mandateUrl ?? 'aucune';
    case 'town':
      return ffta.town;
    case 'departmentCode':
      return `${ffta.departmentCode} - ${DEPARTMENT_NAMES[ffta.departmentCode] ?? ffta.departmentCode}`;
    case 'position':
      return ffta.position ? formatPosition(ffta.position) : 'aucune';
    case 'departures':
      if (!ffta.departures?.length) return 'aucun';
      return ffta.departures
        .map((departure) => {
          const times = [
            departure.registrationOpens && `greffe ${departure.registrationOpens}`,
            departure.shootingStarts && `tir ${departure.shootingStarts}`,
          ].filter(Boolean);
          const date = departure.date ? ` du ${formatDay(departure.date)}` : '';
          return `${departure.label}${date}${times.length > 0 ? ` (${times.join(', ')})` : ''}`;
        })
        .join(' ; ');
    case 'prices':
      if (!ffta.prices?.length) return 'aucun';
      return ffta.prices
        .map(
          (price) =>
            `${AUDIENCE_LABELS[price.audience]}, ${price.departures} ${price.departures > 1 ? 'départs' : 'départ'} : ${euros.format(price.amountEuros)}`,
        )
        .join(' ; ');
  }
}
