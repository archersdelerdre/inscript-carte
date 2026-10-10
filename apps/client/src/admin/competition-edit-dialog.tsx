import {
  API_ROUTES,
  apiPath,
  COMPETITION_STATUSES,
  COMPETITION_STATUS_LABELS,
  DISCIPLINES,
  DISCIPLINE_LABELS,
  MANDATE_AUDIENCES,
  type CompetitionEditDto,
  type CompetitionEditResponse,
  type CompetitionFields,
  type CompetitionOverviewDto,
  type FftaDetailsDto,
} from '@inscript-carte/shared';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';

import {
  AUDIENCE_LABELS,
  buildRequest,
  departmentOptions,
  describeFfta,
  editedKeys,
  fieldsToForm,
  type FormErrors,
  formatPosition,
  type FormState,
  isDirty,
  MAX_DEPARTURES,
  nextRowKey,
  validate,
} from './competition-form';
import { ProblemsAndActions } from './competition-problems';

const PositionPicker = lazy(() => import('./position-picker'));

type Props = {
  competition: CompetitionOverviewDto;
  scraperAvailable: boolean;
  /** Called once the edits are saved: the page reloads its table and closes the dialog. */
  onSaved: () => void;
  onClose: () => void;
  onOpenRegistrations: (competitionId: string) => void;
  onOpenScraper: () => void;
  onSessionExpired: () => void;
};

type FieldKey = keyof CompetitionFields | 'dates';

/** Where an admin changes a competition's values; what the FFTA says stays one click away. */
export function CompetitionEditDialog({
  competition,
  scraperAvailable,
  onSaved,
  onClose,
  onOpenRegistrations,
  onOpenScraper,
  onSessionExpired,
}: Props) {
  const [edit, setEdit] = useState<CompetitionEditDto | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<CompetitionEditResponse>(
      apiPath(API_ROUTES.adminCompetitionOverrides, { competitionId: competition.id }),
    ).then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        if (response.error === 'admin_sign_in_required') onSessionExpired();
        else setLoadError(ERROR_MESSAGES[response.error]);
        return;
      }
      const loaded = response.data.competition;
      setEdit(loaded);
      setForm(fieldsToForm({ ...loaded.ffta, ...loaded.overrides }));
    });
    return () => {
      cancelled = true;
    };
  }, [competition.id, onSessionExpired]);

  const initial = useMemo(() => edit && { ...edit.ffta, ...edit.overrides }, [edit]);
  const edited = useMemo(() => (edit && form ? editedKeys(form, edit.ffta) : []), [edit, form]);
  const errors = useMemo(() => (form ? validate(form, edited) : {}), [form, edited]);
  const hasErrors = Object.keys(errors).length > 0;
  const dirty = edit && form && initial ? isDirty(form, initial) : false;

  function requestClose() {
    if (dirty) setConfirmingClose(true);
    else onClose();
  }

  async function save() {
    if (!edit || !form || hasErrors || saving) return;
    setSaving(true);
    setSaveError(null);
    const response = await api(apiPath(API_ROUTES.adminCompetitionOverrides, { competitionId: competition.id }), {
      method: 'PUT',
      body: buildRequest(form, edit.ffta),
    });
    setSaving(false);
    if (response.ok) onSaved();
    else if (response.error === 'admin_sign_in_required') onSessionExpired();
    else setSaveError(ERROR_MESSAGES[response.error]);
  }

  const lastEdit =
    edit?.updatedByName &&
    `Dernière modification par ${edit.updatedByName}${edit.updatedAt ? ` le ${formatDateTime(edit.updatedAt)}` : ''}.`;

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent
          className='h-svh max-h-svh w-full max-w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-none p-0 sm:h-[calc(100svh-3rem)] sm:max-h-none sm:max-w-5xl sm:rounded-xl'
          // Saving must not be interrupted by a stray click.
          onInteractOutside={(event) => {
            if (saving) event.preventDefault();
          }}
        >
          <DialogHeader className='border-b p-5'>
            <DialogTitle>{competition.title}</DialogTitle>
            <DialogDescription>{lastEdit || 'Les valeurs modifiées remplacent celles de la FFTA.'}</DialogDescription>
          </DialogHeader>

          <div className='overflow-y-auto p-5'>
            {loadError && (
              <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
                {loadError}
              </p>
            )}
            {!edit && !form && !loadError && <p className='text-muted-foreground'>Chargement…</p>}
            {edit && form && (
              <CompetitionForm
                competition={competition}
                edit={edit}
                form={form}
                setForm={setForm}
                edited={edited}
                errors={errors}
                scraperAvailable={scraperAvailable}
                onOpenRegistrations={onOpenRegistrations}
                onOpenScraper={onOpenScraper}
                onSessionExpired={onSessionExpired}
              />
            )}
          </div>

          <DialogFooter className='mx-0 mb-0 items-center sm:justify-end'>
            {saveError && (
              <p role='alert' className='text-destructive text-sm sm:mr-auto'>
                {saveError}
              </p>
            )}
            {!saveError && hasErrors && (
              <p role='alert' className='text-destructive text-sm sm:mr-auto'>
                Corrigez les champs signalés pour pouvoir enregistrer.
              </p>
            )}
            <Button variant='outline' onClick={requestClose}>
              Annuler
            </Button>
            <Button disabled={!dirty || hasErrors || saving} onClick={() => void save()}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingClose} onOpenChange={setConfirmingClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Abandonner vos modifications ?</AlertDialogTitle>
            <AlertDialogDescription>
              Ce que vous avez changé dans ce concours ne sera pas enregistré.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Non, continuer</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>Oui, les abandonner</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type FormProps = {
  competition: CompetitionOverviewDto;
  edit: CompetitionEditDto;
  form: FormState;
  setForm: (update: (current: FormState | null) => FormState | null) => void;
  edited: readonly (keyof CompetitionFields)[];
  errors: FormErrors;
  scraperAvailable: boolean;
  onOpenRegistrations: (competitionId: string) => void;
  onOpenScraper: () => void;
  onSessionExpired: () => void;
};

function CompetitionForm({
  competition,
  edit,
  form,
  setForm,
  edited,
  errors,
  scraperAvailable,
  onOpenRegistrations,
  onOpenScraper,
  onSessionExpired,
}: FormProps) {
  const { ffta } = edit;
  const departments = useMemo(() => departmentOptions(form.departmentCode), [form.departmentCode]);

  function patch(changes: Partial<FormState>) {
    setForm((current) => current && { ...current, ...changes });
  }

  function revert(...keys: (keyof CompetitionFields)[]) {
    const original = fieldsToForm(ffta);
    const changes: Record<string, unknown> = {};
    for (const key of keys) changes[key] = original[key];
    patch(changes as Partial<FormState>);
  }

  function note(key: FieldKey, ...revertKeys: (keyof CompetitionFields)[]) {
    let keys = revertKeys;
    if (keys.length === 0 && key !== 'dates') keys = [key];
    if (!keys.some((candidate) => edited.includes(candidate))) return null;
    return <EditedNote ffta={describeFfta(key, ffta)} onRevert={() => revert(...keys)} />;
  }

  return (
    <div className='grid gap-8'>
      <Section title='Problèmes et actions'>
        <ProblemsAndActions
          competition={competition}
          scraperAvailable={scraperAvailable}
          onOpenRegistrations={onOpenRegistrations}
          onOpenScraper={onOpenScraper}
          onSessionExpired={onSessionExpired}
        />
      </Section>

      <Section title='Informations'>
        <Field label='Titre' htmlFor='edit-title' error={errors.title}>
          <Input
            id='edit-title'
            value={form.title}
            aria-invalid={Boolean(errors.title)}
            onChange={(event) => patch({ title: event.target.value })}
          />
          {note('title')}
        </Field>

        <div className='grid gap-4 sm:grid-cols-2'>
          <Field label='Date de début' htmlFor='edit-start'>
            <Input
              id='edit-start'
              type='date'
              value={form.startDate}
              aria-invalid={Boolean(errors.dates)}
              onChange={(event) => patch({ startDate: event.target.value })}
            />
          </Field>
          <Field label='Date de fin' htmlFor='edit-end'>
            <Input
              id='edit-end'
              type='date'
              value={form.endDate}
              aria-invalid={Boolean(errors.dates)}
              onChange={(event) => patch({ endDate: event.target.value })}
            />
          </Field>
        </div>
        {errors.dates && <FieldError>{errors.dates}</FieldError>}
        {note('dates', 'startDate', 'endDate')}

        <div className='grid gap-4 sm:grid-cols-2'>
          <Field label='Discipline' htmlFor='edit-discipline'>
            <Select
              value={form.discipline}
              onValueChange={(value) => patch({ discipline: value as FormState['discipline'] })}
            >
              <SelectTrigger id='edit-discipline' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISCIPLINES.map((discipline) => (
                  <SelectItem key={discipline} value={discipline}>
                    {DISCIPLINE_LABELS[discipline]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {note('discipline')}
          </Field>
          <Field label='État' htmlFor='edit-status'>
            <Select value={form.status} onValueChange={(value) => patch({ status: value as FormState['status'] })}>
              <SelectTrigger id='edit-status' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPETITION_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {COMPETITION_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {note('status')}
          </Field>
        </div>

        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='grid content-start gap-1.5'>
            <div className='flex items-center gap-2'>
              <Checkbox
                id='edit-para'
                checked={form.hasParaTir}
                onCheckedChange={(checked) => patch({ hasParaTir: checked === true })}
              />
              <Label htmlFor='edit-para'>Para-tir</Label>
            </div>
            {note('hasParaTir')}
          </div>
          <div className='grid content-start gap-1.5'>
            <div className='flex items-center gap-2'>
              <Checkbox
                id='edit-foam'
                checked={form.hasFoamTargets}
                onCheckedChange={(checked) => patch({ hasFoamTargets: checked === true })}
              />
              <Label htmlFor='edit-foam'>Cibles mousses</Label>
            </div>
            {note('hasFoamTargets')}
          </div>
        </div>

        <Field label='Lien du mandat' htmlFor='edit-mandate' error={errors.mandateUrl}>
          <Input
            id='edit-mandate'
            type='url'
            inputMode='url'
            placeholder='https://'
            value={form.mandateUrl}
            aria-invalid={Boolean(errors.mandateUrl)}
            onChange={(event) => patch({ mandateUrl: event.target.value })}
          />
          {note('mandateUrl')}
        </Field>
      </Section>

      <Section title='Lieu'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field label='Ville' htmlFor='edit-town' error={errors.town}>
            <Input
              id='edit-town'
              value={form.town}
              aria-invalid={Boolean(errors.town)}
              onChange={(event) => patch({ town: event.target.value })}
            />
            {note('town')}
          </Field>
          <Field label='Département' htmlFor='edit-department'>
            <Select value={form.departmentCode} onValueChange={(value) => patch({ departmentCode: value })}>
              <SelectTrigger id='edit-department' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {departments.map(({ code, label }) => (
                  <SelectItem key={code} value={code}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {note('departmentCode')}
          </Field>
        </div>

        <div className='grid gap-1.5'>
          <span className='font-medium'>Position sur la carte</span>
          <FftaAddress details={edit.details} />
          <p className='text-muted-foreground text-sm'>Cliquez sur la carte pour placer ou déplacer le point.</p>
          <Suspense
            fallback={<div className='text-muted-foreground grid h-72 place-items-center'>Chargement de la carte…</div>}
          >
            <PositionPicker position={form.position} onChange={(position) => patch({ position })} />
          </Suspense>
          <p className='text-muted-foreground text-sm' aria-live='polite'>
            {form.position ? `Coordonnées : ${formatPosition(form.position)}` : 'Aucune position pour ce concours.'}
          </p>
          {note('position')}
        </div>
      </Section>

      <Section title='Mandat'>
        <p className='text-muted-foreground'>
          Ces départs et ces tarifs remplacent ce qui a été lu dans le mandat : ils servent au formulaire d’inscription
          et au fichier Excel.
        </p>
        <DeparturesEditor form={form} patch={patch} error={errors.departures} />
        {note('departures')}
        <PricesEditor form={form} patch={patch} error={errors.prices} />
        {note('prices')}
      </Section>

      <Section title='Lu sur le site de la FFTA'>
        <FftaDetails details={edit.details} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='grid gap-4'>
      <h3 className='border-b pb-1 text-lg font-semibold'>{title}</h3>
      {children}
    </section>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className='grid content-start gap-1.5'>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return (
    <p role='alert' className='text-destructive text-sm'>
      {children}
    </p>
  );
}

function EditedNote({ ffta, onRevert }: { ffta: string; onRevert: () => void }) {
  return (
    <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-sm'>
      <Badge variant='secondary'>Modifié</Badge>
      <span className='text-muted-foreground'>Valeur FFTA : {ffta}</span>
      <button type='button' className='text-primary cursor-pointer underline underline-offset-2' onClick={onRevert}>
        Revenir à la valeur FFTA
      </button>
    </div>
  );
}

function FftaAddress({ details }: { details: FftaDetailsDto }) {
  const lines = [
    details.venue,
    ...details.streetLines,
    [details.postalCode, details.city].filter(Boolean).join(' '),
    details.country,
  ].filter(Boolean);
  return (
    <div className='bg-muted/50 rounded-lg px-3 py-2 text-sm'>
      <p className='font-medium'>Adresse indiquée par la FFTA</p>
      {lines.length === 0 ? (
        <p className='text-muted-foreground'>La FFTA ne donne pas d’adresse pour ce concours.</p>
      ) : (
        <p>
          {lines.map((line, index) => (
            <span key={index} className='block'>
              {line}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

type EditorProps = { form: FormState; patch: (changes: Partial<FormState>) => void; error?: string };

function DeparturesEditor({ form, patch, error }: EditorProps) {
  const rows = form.departures;
  const columns = 'sm:grid-cols-[minmax(0,1fr)_10rem_8rem_8rem_auto]';

  function update(key: number, changes: Partial<FormState['departures'][number]>) {
    patch({ departures: rows.map((row) => (row.key === key ? { ...row, ...changes } : row)) });
  }

  return (
    <div className='grid gap-2'>
      <h4 className='font-semibold'>Départs</h4>
      {rows.length === 0 ? (
        <p className='text-muted-foreground'>Aucun départ : le formulaire d’inscription propose les départs 1 à 4.</p>
      ) : (
        <>
          <div className={`hidden gap-2 text-sm font-medium sm:grid ${columns}`} aria-hidden='true'>
            <span>Nom</span>
            <span>Date</span>
            <span>Greffe</span>
            <span>Début du tir</span>
            <span className='w-10' />
          </div>
          {rows.map((row, index) => (
            <div key={row.key} className={`grid gap-2 rounded-lg border p-3 sm:border-0 sm:p-0 ${columns}`}>
              <div className='grid gap-1'>
                <Label htmlFor={`departure-${row.key}-label`} className='sm:sr-only'>
                  Nom du départ {index + 1}
                </Label>
                <Input
                  id={`departure-${row.key}-label`}
                  value={row.label}
                  placeholder='Samedi après-midi'
                  onChange={(event) => update(row.key, { label: event.target.value })}
                />
              </div>
              <div className='grid gap-1'>
                <Label htmlFor={`departure-${row.key}-date`} className='sm:sr-only'>
                  Date du départ {index + 1}
                </Label>
                <Input
                  id={`departure-${row.key}-date`}
                  type='date'
                  value={row.date}
                  onChange={(event) => update(row.key, { date: event.target.value })}
                />
              </div>
              <div className='grid gap-1'>
                <Label htmlFor={`departure-${row.key}-opens`} className='sm:sr-only'>
                  Greffe du départ {index + 1}
                </Label>
                <Input
                  id={`departure-${row.key}-opens`}
                  type='time'
                  value={row.registrationOpens}
                  onChange={(event) => update(row.key, { registrationOpens: event.target.value })}
                />
              </div>
              <div className='grid gap-1'>
                <Label htmlFor={`departure-${row.key}-starts`} className='sm:sr-only'>
                  Début du tir du départ {index + 1}
                </Label>
                <Input
                  id={`departure-${row.key}-starts`}
                  type='time'
                  value={row.shootingStarts}
                  onChange={(event) => update(row.key, { shootingStarts: event.target.value })}
                />
              </div>
              <Button
                variant='ghost'
                size='icon'
                className='justify-self-end'
                aria-label={`Retirer le départ ${index + 1}`}
                onClick={() => patch({ departures: rows.filter((other) => other.key !== row.key) })}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </>
      )}
      {error && <FieldError>{error}</FieldError>}
      <div>
        <Button
          variant='outline'
          disabled={rows.length >= MAX_DEPARTURES}
          onClick={() =>
            patch({
              departures: [
                ...rows,
                {
                  key: nextRowKey(),
                  label: `Départ ${rows.length + 1}`,
                  date: '',
                  registrationOpens: '',
                  shootingStarts: '',
                },
              ],
            })
          }
        >
          <PlusIcon />
          Ajouter un départ
        </Button>
      </div>
    </div>
  );
}

function PricesEditor({ form, patch, error }: EditorProps) {
  const rows = form.prices;
  const columns = 'sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]';

  function update(key: number, changes: Partial<FormState['prices'][number]>) {
    patch({ prices: rows.map((row) => (row.key === key ? { ...row, ...changes } : row)) });
  }

  return (
    <div className='grid gap-2'>
      <h4 className='font-semibold'>Tarifs</h4>
      {rows.length === 0 ? (
        <p className='text-muted-foreground'>Aucun tarif : le montant reste vide dans le fichier Excel.</p>
      ) : (
        <>
          <div className={`hidden gap-2 text-sm font-medium sm:grid ${columns}`} aria-hidden='true'>
            <span>Public</span>
            <span>Nombre de départs</span>
            <span>Montant (€)</span>
            <span className='w-10' />
          </div>
          {rows.map((row, index) => (
            <div key={row.key} className={`grid gap-2 rounded-lg border p-3 sm:border-0 sm:p-0 ${columns}`}>
              <div className='grid gap-1'>
                <Label htmlFor={`price-${row.key}-audience`} className='sm:sr-only'>
                  Public du tarif {index + 1}
                </Label>
                <Select
                  value={row.audience}
                  onValueChange={(value) => update(row.key, { audience: value as typeof row.audience })}
                >
                  <SelectTrigger id={`price-${row.key}-audience`} className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MANDATE_AUDIENCES.map((audience) => (
                      <SelectItem key={audience} value={audience}>
                        {AUDIENCE_LABELS[audience]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='grid gap-1'>
                <Label htmlFor={`price-${row.key}-departures`} className='sm:sr-only'>
                  Nombre de départs du tarif {index + 1}
                </Label>
                <Input
                  id={`price-${row.key}-departures`}
                  type='number'
                  inputMode='numeric'
                  min={1}
                  max={MAX_DEPARTURES}
                  value={row.departures}
                  onChange={(event) => update(row.key, { departures: event.target.value })}
                />
              </div>
              <div className='grid gap-1'>
                <Label htmlFor={`price-${row.key}-amount`} className='sm:sr-only'>
                  Montant du tarif {index + 1}, en euros
                </Label>
                <Input
                  id={`price-${row.key}-amount`}
                  type='number'
                  inputMode='decimal'
                  min={0}
                  max={150}
                  step='0.5'
                  value={row.amount}
                  onChange={(event) => update(row.key, { amount: event.target.value })}
                />
              </div>
              <Button
                variant='ghost'
                size='icon'
                className='justify-self-end'
                aria-label={`Retirer le tarif ${index + 1}`}
                onClick={() => patch({ prices: rows.filter((other) => other.key !== row.key) })}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </>
      )}
      {error && <FieldError>{error}</FieldError>}
      <div>
        <Button
          variant='outline'
          onClick={() =>
            patch({ prices: [...rows, { key: nextRowKey(), audience: 'all', departures: '1', amount: '' }] })
          }
        >
          <PlusIcon />
          Ajouter un tarif
        </Button>
      </div>
    </div>
  );
}

function externalHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function FftaDetails({ details }: { details: FftaDetailsDto }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Club organisateur', value: details.organizerClub },
    {
      label: 'Courriel',
      value: details.organizerEmail && (
        <a className='text-primary underline' href={`mailto:${details.organizerEmail}`}>
          {details.organizerEmail}
        </a>
      ),
    },
    { label: 'Téléphone', value: details.organizerPhone },
    {
      label: 'Site web',
      value: details.organizerWebsite && (
        <a
          className='text-primary underline'
          href={externalHref(details.organizerWebsite)}
          target='_blank'
          rel='noopener'
        >
          {details.organizerWebsite}
        </a>
      ),
    },
    { label: 'Championnat', value: details.championship },
    { label: 'Duels', value: yesNo(details.hasDuels) },
    { label: 'Comité régional', value: details.regionalCommittee },
    { label: 'Comité départemental', value: details.departmentalCommittee },
  ];
  return (
    <dl className='grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]'>
      {rows.map(({ label, value }) => (
        <div key={label} className='grid grid-cols-subgrid gap-x-6 sm:col-span-2'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd className='break-words'>{value || <span className='text-muted-foreground'>Non renseigné</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function yesNo(value: boolean | null): string | null {
  if (value === null) return null;
  return value ? 'Oui' : 'Non';
}
