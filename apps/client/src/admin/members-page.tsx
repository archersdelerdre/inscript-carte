import {
  apiPath,
  API_ROUTES,
  categoryLabel,
  type AdminMemberDto,
  type ApiError,
  type GrantAdminResponse,
  type ListAdminMembersResponse,
  type MemberExportErrorResponse,
  type MemberExportProblem,
  type MemberImportDto,
  type MemberImportStatusResponse,
  type UpdateMemberRequest,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import {
  CopyIcon,
  EllipsisVerticalIcon,
  SearchIcon,
  ShieldOffIcon,
  ShieldPlusIcon,
  UploadIcon,
  UserCheckIcon,
  UserXIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

type Props = {
  /** The signed-in admin: no action on their own row. */
  currentLicenceNumber: string;
  onSessionExpired: () => void;
};

type MemberAction = 'deactivate' | 'reactivate' | 'grant' | 'revoke';

/** Every club member in a table, with their actions, and the update of the list from the FFTA extranet export. */
export function MembersPage({ currentLicenceNumber, onSessionExpired }: Props) {
  const [members, setMembers] = useState<AdminMemberDto[] | null>(null);
  const [status, setStatus] = useState<MemberImportStatusResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [importOpen, setImportOpen] = useState(false);
  const [pending, setPending] = useState<{ action: MemberAction; member: AdminMemberDto } | null>(null);
  const [granted, setGranted] = useState<{ member: AdminMemberDto; password: string } | null>(null);

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

  async function run(action: MemberAction, member: AdminMemberDto) {
    setPending(null);
    const licenceNumber = member.licenceNumber;
    let result: ApiResult<unknown>;
    if (action === 'grant') {
      const response = await api<GrantAdminResponse>(apiPath(API_ROUTES.adminMemberAdminRights, { licenceNumber }), {
        method: 'POST',
      });
      if (response.ok) setGranted({ member, password: response.data.password });
      result = response;
    } else if (action === 'revoke') {
      result = await api(apiPath(API_ROUTES.adminMemberAdminRights, { licenceNumber }), { method: 'DELETE' });
    } else {
      result = await api(apiPath(API_ROUTES.adminMember, { licenceNumber }), {
        method: 'PATCH',
        body: { isActive: action === 'reactivate' } satisfies UpdateMemberRequest,
      });
    }
    if (!result.ok && result.error === 'admin_sign_in_required') return onSessionExpired();
    setMessage(result.ok ? null : ERROR_MESSAGES[result.error]);
    reload();
  }

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
            <table className='w-full min-w-[640px] border-collapse text-left'>
              <thead className='bg-muted whitespace-nowrap'>
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
                  {/* Pinned to the right: on phones the menu stays visible while the other columns scroll. */}
                  <th scope='col' className='bg-muted sticky right-0 px-3 py-2 text-right font-semibold'>
                    Actions
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
                    <td className='bg-background sticky right-0 px-3 py-1 text-right'>
                      {member.licenceNumber === currentLicenceNumber ? (
                        <span className='text-muted-foreground text-sm'>Vous</span>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant='ghost' size='icon' aria-label={`Actions pour ${member.fullName}`}>
                              <EllipsisVerticalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem
                              onSelect={() =>
                                setPending({ action: member.isActive ? 'deactivate' : 'reactivate', member })
                              }
                            >
                              {member.isActive ? <UserXIcon /> : <UserCheckIcon />}
                              {member.isActive ? 'Désactiver' : 'Réactiver'}
                            </DropdownMenuItem>
                            {member.isAdmin ? (
                              <DropdownMenuItem
                                variant='destructive'
                                onSelect={() => setPending({ action: 'revoke', member })}
                              >
                                <ShieldOffIcon />
                                Retirer les droits d’admin
                              </DropdownMenuItem>
                            ) : (
                              // An admin must be able to sign in: a member who left cannot become one.
                              <DropdownMenuItem
                                disabled={!member.isActive}
                                onSelect={() => setPending({ action: 'grant', member })}
                              >
                                <ShieldPlusIcon />
                                Nommer admin
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
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

      {pending && (
        <ConfirmActionDialog
          action={pending.action}
          member={pending.member}
          onCancel={() => setPending(null)}
          onConfirm={() => void run(pending.action, pending.member)}
        />
      )}
      {granted && (
        <GrantedPasswordDialog member={granted.member} password={granted.password} onClose={() => setGranted(null)} />
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

/** What each action does, said before it is done. */
function confirmation(action: MemberAction, member: AdminMemberDto): { title: string; text: string; button: string } {
  const nextImport = 'La prochaine mise à jour de la liste FFTA remettra l’état indiqué dans le fichier.';
  switch (action) {
    case 'deactivate':
      return {
        title: `Désactiver ${member.fullName} ?`,
        text: `Il ne pourra plus se connecter ni s’inscrire. Ses inscriptions passées sont gardées.${
          member.isAdmin ? ' Il perd aussi l’accès à l’administration tant qu’il est désactivé.' : ''
        } ${nextImport}`,
        button: 'Oui, désactiver',
      };
    case 'reactivate':
      return {
        title: `Réactiver ${member.fullName} ?`,
        text: `Il pourra de nouveau se connecter et s’inscrire. ${nextImport}`,
        button: 'Oui, réactiver',
      };
    case 'grant':
      return {
        title: `Nommer ${member.fullName} administrateur ?`,
        text:
          'Il verra toutes les inscriptions et les coordonnées des licenciés. Un mot de passe provisoire va être ' +
          'créé : vous devrez le lui donner. À sa première connexion, il choisira le sien.',
        button: 'Oui, nommer admin',
      };
    case 'revoke':
      return {
        title: `Retirer les droits d’administrateur de ${member.fullName} ?`,
        text: 'Il est déconnecté de l’administration tout de suite. Il reste licencié et peut toujours s’inscrire.',
        button: 'Oui, retirer',
      };
  }
}

type ConfirmActionDialogProps = {
  action: MemberAction;
  member: AdminMemberDto;
  onCancel: () => void;
  onConfirm: () => void;
};

function ConfirmActionDialog({ action, member, onCancel, onConfirm }: ConfirmActionDialogProps) {
  const { title, text, button } = confirmation(action, member);
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{text}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{button}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The only time the generated password is shown. */
function GrantedPasswordDialog({
  member,
  password,
  onClose,
}: {
  member: AdminMemberDto;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{member.fullName} est administrateur</DialogTitle>
          <DialogDescription>
            Donnez-lui ce mot de passe provisoire, de préférence de vive voix. Il ne sera plus jamais affiché.
          </DialogDescription>
        </DialogHeader>
        <p className='bg-muted rounded-md px-4 py-3 text-center font-mono text-2xl font-semibold tracking-wider select-all'>
          {password}
        </p>
        <p className='text-sm'>
          Pour se connecter : aller sur la page d’administration, se connecter avec sa licence et sa date de naissance,
          puis taper ce mot de passe. Il devra ensuite choisir son propre mot de passe.
        </p>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() =>
              void navigator.clipboard
                ?.writeText(password)
                .then(() => setCopied(true))
                .catch(() => {})
            }
          >
            <CopyIcon />
            {copied ? 'Copié' : 'Copier'}
          </Button>
          <Button onClick={onClose}>J’ai noté le mot de passe</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
              Les nouveaux licenciés sont ajoutés, les autres mis à jour. Le fichier n'est pas conservé.
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

/** "108 licenciés dans le fichier, 2 ajoutés, 1 mis à jour, 105 inchangés" */
function summary({ memberCount, added, updated, unchanged }: MemberImportDto): string {
  return [
    `${memberCount} licenciés dans le fichier`,
    `${added} ${added > 1 ? 'ajoutés' : 'ajouté'}`,
    `${updated} mis à jour`,
    `${unchanged} ${unchanged > 1 ? 'inchangés' : 'inchangé'}`,
  ].join(', ');
}
