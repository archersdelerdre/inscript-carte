import {
  API_ROUTES,
  type ApiError,
  type MemberExportErrorResponse,
  type MemberExportProblem,
  type MemberImportDto,
  type MemberImportStatusResponse,
} from '@inscript-carte/shared';
import { UploadIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

type Props = { onSessionExpired: () => void };

/** Replaces the member list with a new FFTA extranet export: the base of the members' sign-in. */
export function MemberImport({ onSessionExpired }: Props) {
  const [status, setStatus] = useState<MemberImportStatusResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<MemberImportDto | null>(null);
  const [sending, setSending] = useState(false);

  const showStatus = useCallback(
    (response: ApiResult<MemberImportStatusResponse>) => {
      if (response.ok) return setStatus(response.data);
      if (response.error === 'admin_sign_in_required') return onSessionExpired();
      setMessage(ERROR_MESSAGES[response.error]);
    },
    [onSessionExpired],
  );

  useEffect(() => {
    void api<MemberImportStatusResponse>(API_ROUTES.adminMemberImport).then(showStatus);
  }, [showStatus]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!file) return setMessage('Choisissez d’abord le fichier Excel exporté de l’extranet FFTA.');
    setSending(true);
    setMessage(null);
    setResult(null);
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
    setStatus(data);
    setResult(data.lastImport);
    setFile(null);
    form.reset();
  }

  return (
    <main className='mx-auto grid w-full max-w-2xl content-start gap-6 p-4'>
      <section className='grid gap-2'>
        <h1 className='text-xl font-semibold tracking-tight'>Liste des licenciés</h1>
        {status && (
          <p>
            <strong>{status.activeMemberCount}</strong> licenciés actifs peuvent se connecter.
          </p>
        )}
        {status && <LastImport lastImport={status.lastImport} />}
      </section>

      <form onSubmit={submit} className='grid gap-4 rounded-lg border p-4'>
        <h2 className='text-lg font-semibold tracking-tight'>Mettre à jour la liste</h2>
        <ol className='text-muted-foreground list-decimal space-y-1 pl-5'>
          <li>Sur l'extranet FFTA, exportez la liste des licenciés du club (fichier Excel .xlsx).</li>
          <li>Choisissez ce fichier ci-dessous, puis cliquez sur « Importer ».</li>
        </ol>
        <p className='text-sm'>
          Les nouveaux licenciés sont ajoutés, les autres mis à jour. Ceux qui ne sont plus dans le fichier ne peuvent
          plus se connecter (leurs inscriptions passées sont gardées). Le fichier n'est pas conservé.
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
        {result && (
          <p role='status' className='rounded-md bg-green-50 px-3 py-2 text-sm text-green-900'>
            Liste importée : {summary(result)}.
          </p>
        )}
        <Button type='submit' className='w-fit' disabled={sending}>
          <UploadIcon />
          {sending ? 'Import en cours…' : 'Importer'}
        </Button>
      </form>
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
      {lastImport.importedByName ? ` par ${lastImport.importedByName}` : ' (en ligne de commande)'} :{' '}
      {summary(lastImport)}.
    </p>
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
