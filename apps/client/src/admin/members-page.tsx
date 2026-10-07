import {
  API_ROUTES,
  categoryLabel,
  type AdminMemberDto,
  type ApiError,
  type ListAdminMembersResponse,
  type MemberExportErrorResponse,
  type MemberExportProblem,
  type MemberImportDto,
  type MemberImportStatusResponse,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import { SearchIcon, UploadIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { api, type ApiResult } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';

const PROBLEM_MESSAGES: Record<MemberExportProblem, string> = {
  unreadable: "Ce fichier n'est pas un fichier Excel (.xlsx)",
  too_large: 'Ce fichier est trop gros pour être la liste des licenciés',
  empty: 'Ce fichier est vide',
  missing_column: 'Il manque une colonne attendue dans le fichier',
  no_members: 'Ce fichier ne contient aucun licencié',
  invalid_licence: "Un numéro de licence n'a pas le bon format (7 chiffres et une lettre)",
  duplicate_licence: 'Un numéro de licence apparaît deux fois',
  missing_name: 'Un nom manque',
  unknown_sex: 'Le sexe est inconnu (attendu : Masculin ou Féminin)',
  invalid_birth_date: 'Une date de naissance manque ou est illisible',
};

/** "Un nom manque : ligne 12. Rien n'a été importé." */
function problemMessage({ problem, line, detail }: MemberExportErrorResponse): string {
  const where = [detail && `« ${detail} »`, line !== null && `ligne ${line}`].filter(Boolean).join(', ');
  return `${PROBLEM_MESSAGES[problem]}${where ? ` : ${where}` : ''}. Rien n'a été importé.`;
}

/** "Dupont-Hélène" and "dupont helene" match: accents, case and dashes are ignored. */
function searchable(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-']/g, ' ')
    .toLowerCase();
}

type StateFilter = 'all' | 'active' | 'left';

type Props = { onSessionExpired: () => void };

/** Every club member in a table, and the update of the list from the FFTA extranet export. */
export function MembersPage({ onSessionExpired }: Props) {
  const [members, setMembers] = useState<AdminMemberDto[] | null>(null);
  const [status, setStatus] = useState<MemberImportStatusResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [importOpen, setImportOpen] = useState(false);

  const showResult = useCallback(
    <T,>(apply: (data: T) => void) =>
      (response: ApiResult<T>) => {
        if (response.ok) return apply(response.data);
        if (response.error === 'admin_sign_in_required') return onSessionExpired();
        setMessage(ERROR_MESSAGES[response.error]);
      },
    [onSessionExpired],
  );
  const reload = useCallback(() => {
    void api<ListAdminMembersResponse>(API_ROUTES.adminMembers).then(
      showResult<ListAdminMembersResponse>((data) => setMembers(data.members)),
    );
    void api<MemberImportStatusResponse>(API_ROUTES.adminMemberImport).then(showResult(setStatus));
  }, [showResult]);

  useEffect(reload, [reload]);

  const words = searchable(query).split(/\s+/).filter(Boolean);
  const shown = (members ?? []).filter(
    (member) =>
      (stateFilter === 'all' || member.isActive === (stateFilter === 'active')) &&
      words.every((word) => searchable(`${member.fullName} ${member.licenceNumber}`).includes(word)),
  );
  const leftCount = members?.filter((member) => !member.isActive).length ?? 0;

  return (
    <main className='mx-auto grid w-full max-w-5xl content-start gap-4 p-4'>
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div className='grid gap-1'>
          <h1 className='text-xl font-semibold tracking-tight'>Licenciés</h1>
          {status && (
            <p>
              <strong>{status.activeMemberCount}</strong> licenciés actifs
              {leftCount > 0 && `, ${leftCount} qui ne font plus partie du club`}.
            </p>
          )}
          {status && <LastImport lastImport={status.lastImport} />}
        </div>
        <Button onClick={() => setImportOpen(true)}>
          <UploadIcon />
          Mettre à jour la liste
        </Button>
      </header>

      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative min-w-64 flex-1'>
          <SearchIcon className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-[1.125rem] -translate-y-1/2' />
          <Input
            aria-label='Chercher un licencié'
            placeholder='Nom ou numéro de licence'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className='pl-10'
          />
        </div>
        <Select value={stateFilter} onValueChange={(value) => setStateFilter(value as StateFilter)}>
          <SelectTrigger aria-label='État' className='min-w-56'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Tous les licenciés</SelectItem>
            <SelectItem value='active'>Actifs seulement</SelectItem>
            <SelectItem value='left'>Plus au club seulement</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {message && (
        <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
          {message}
        </p>
      )}
      {members === null && !message && <p className='text-muted-foreground'>Chargement…</p>}

      {members && (
        <>
          <p className='text-muted-foreground text-sm' aria-live='polite'>
            {shown.length} {shown.length > 1 ? 'licenciés affichés' : 'licencié affiché'}
          </p>
          {/* Scrolls sideways on phones instead of squeezing the columns. */}
          <div className='overflow-x-auto rounded-lg border'>
            <table className='w-full min-w-[560px] border-collapse text-left'>
              <thead className='bg-muted/50 whitespace-nowrap'>
                <tr>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    Nom
                  </th>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    N° de licence
                  </th>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    Catégorie (saison en cours)
                  </th>
                  <th scope='col' className='px-3 py-2 font-semibold'>
                    État
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((member) => (
                  <tr
                    key={member.licenceNumber}
                    className={cn('border-t', !member.isActive && 'text-muted-foreground')}
                  >
                    <td className='px-3 py-2'>
                      <span className='font-medium'>{member.fullName}</span>
                      {member.isAdmin && <Badge className='ml-2 bg-sky-100 text-sky-900'>Admin</Badge>}
                    </td>
                    <td className='px-3 py-2 whitespace-nowrap tabular-nums'>{member.licenceNumber}</td>
                    <td className='px-3 py-2 whitespace-nowrap'>{categoryLabel(member.category, member.sex)}</td>
                    <td className='px-3 py-2 whitespace-nowrap'>{member.isActive ? 'Actif' : 'Plus au club'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {importOpen && (
        <ImportDialog onClose={() => setImportOpen(false)} onImported={reload} onSessionExpired={onSessionExpired} />
      )}
    </main>
  );
}

function LastImport({ lastImport }: { lastImport: MemberImportDto | null }) {
  if (!lastImport) {
    return <p className='text-muted-foreground'>La liste n'a encore jamais été importée depuis cette page.</p>;
  }
  return (
    <p className='text-muted-foreground'>
      Dernière mise à jour le {formatDateTime(lastImport.importedAt)}
      {lastImport.importedByName ? ` par ${lastImport.importedByName}` : ' (en ligne de commande)'}.
    </p>
  );
}

type ImportDialogProps = { onClose: () => void; onImported: () => void; onSessionExpired: () => void };

/** Replaces the member list with a new FFTA extranet export: the base of the members' sign-in. */
function ImportDialog({ onClose, onImported, onSessionExpired }: ImportDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<MemberImportDto | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return setMessage('Choisissez d’abord le fichier Excel exporté de l’extranet FFTA.');
    setSending(true);
    setMessage(null);
    const body = new FormData();
    body.set('file', file);
    const response = await fetch(API_ROUTES.adminMemberImport, { method: 'POST', body }).catch(() => null);
    setSending(false);
    if (!response) return setMessage(ERROR_MESSAGES.network);
    const data = (await response.json()) as MemberImportStatusResponse | ApiError | MemberExportErrorResponse;
    if ('error' in data) {
      if (data.error === 'admin_sign_in_required') return onSessionExpired();
      return setMessage(
        data.error === 'invalid_member_export' && 'problem' in data ? problemMessage(data) : ERROR_MESSAGES[data.error],
      );
    }
    setResult(data.lastImport);
    onImported();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Mettre à jour la liste des licenciés</DialogTitle>
          <DialogDescription>
            Sur l'extranet FFTA, exportez la liste des licenciés du club (fichier Excel .xlsx), puis choisissez-la ici.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <p role='status' className='rounded-md bg-green-50 px-3 py-2 text-sm text-green-900'>
              Liste importée : {summary(result)}.
            </p>
            <DialogFooter>
              <Button onClick={onClose}>Fermer</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className='grid gap-4' noValidate>
            <p className='text-sm'>
              Les nouveaux licenciés sont ajoutés, les autres mis à jour. Ceux qui ne sont plus dans le fichier ne
              peuvent plus se connecter (leurs inscriptions passées sont gardées). Le fichier n'est pas conservé.
            </p>
            <div className='grid gap-2'>
              <Label htmlFor='member-export'>Fichier de l'extranet FFTA</Label>
              <Input
                id='member-export'
                type='file'
                accept='.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                className='h-auto py-2'
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            {message && (
              <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
                {message}
              </p>
            )}
            <DialogFooter>
              <Button type='button' variant='outline' onClick={onClose}>
                Annuler
              </Button>
              <Button type='submit' disabled={sending}>
                <UploadIcon />
                {sending ? 'Import en cours…' : 'Importer'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "108 licenciés dans le fichier, 2 ajoutés, 1 mis à jour, 3 désactivés, 102 inchangés" */
function summary({ memberCount, added, updated, deactivated, unchanged }: MemberImportDto): string {
  return [
    `${memberCount} licenciés dans le fichier`,
    `${added} ${added > 1 ? 'ajoutés' : 'ajouté'}`,
    `${updated} mis à jour`,
    `${deactivated} ${deactivated > 1 ? 'désactivés' : 'désactivé'}`,
    `${unchanged} ${unchanged > 1 ? 'inchangés' : 'inchangé'}`,
  ].join(', ');
}
