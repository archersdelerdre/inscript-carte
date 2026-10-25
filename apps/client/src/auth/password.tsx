import {
  API_ROUTES,
  MIN_ADMIN_PASSWORD_LENGTH,
  MIN_MEMBER_PASSWORD_LENGTH,
  type ChangeMemberPasswordRequest,
  type RemoveMemberPasswordRequest,
} from '@inscript-carte/shared';
import { KeyRoundIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

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
import { api } from '@/lib/api';
import { ERROR_MESSAGES } from '@/registrations/messages';

import { useSession } from './session';

/**
 * `hadPassword`: as it was when the dialog opened, so the texts do not change once it is saved. `isAdmin`: their
 * password is also the panel's (one password per person), as long as an admin's and never removed.
 */
type Opened = { kind: 'change'; hadPassword: boolean; isAdmin: boolean } | { kind: 'remove' };

/**
 * « Mot de passe » in the header, on the site (left of « Mon suivi ») and in the panel: the one password of a person
 * (optional for members, asked by members 2026-10-25; always there for admins).
 */
export function PasswordButton() {
  const { archer } = useSession();
  const [opened, setOpened] = useState<Opened | null>(null);
  if (!archer) return null;
  return (
    <>
      <Button
        variant='ghost'
        className='shrink-0'
        onClick={() => setOpened({ kind: 'change', hadPassword: archer.hasPassword, isAdmin: archer.isAdmin })}
      >
        <KeyRoundIcon />
        <span className='max-sm:sr-only'>Mot de passe</span>
      </Button>
      {opened?.kind === 'change' && (
        <ChangePasswordDialog
          hadPassword={opened.hadPassword}
          isAdmin={opened.isAdmin}
          onRemove={() => setOpened({ kind: 'remove' })}
          onClose={() => setOpened(null)}
        />
      )}
      {opened?.kind === 'remove' && <RemovePasswordDialog onClose={() => setOpened(null)} />}
    </>
  );
}

type NewPasswordFormProps = {
  /** `false` to add a first password, or to replace a generated admin password right after signing in with it. */
  askCurrent: boolean;
  minLength: number;
  header?: ReactNode;
  /** Buttons before « Enregistrer » (« Annuler »…). */
  otherActions?: ReactNode;
  /** In a dialog: the actions go in its footer. */
  inDialog: boolean;
  onSaved: () => void;
};

/** Current password when asked, new one twice; `PUT /api/me/password`, the one route for every password. */
export function NewPasswordForm({
  askCurrent,
  minLength,
  header,
  otherActions,
  inDialog,
  onSaved,
}: NewPasswordFormProps) {
  const { setHasPassword, sessionExpired } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const Actions = inDialog ? DialogFooter : 'div';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (askCurrent && !currentPassword) return setMessage('Merci de taper votre mot de passe actuel.');
    if (newPassword.length < minLength) {
      return setMessage(`Le mot de passe doit avoir au moins ${minLength} caractères.`);
    }
    if (newPassword !== confirmation) return setMessage('Les deux mots de passe ne sont pas identiques.');

    setSending(true);
    const body: ChangeMemberPasswordRequest = { currentPassword: askCurrent ? currentPassword : null, newPassword };
    const result = await api(API_ROUTES.myPassword, { method: 'PUT', body });
    setSending(false);
    if (!result.ok) {
      if (result.error === 'not_signed_in') return sessionExpired();
      return setMessage(ERROR_MESSAGES[result.error]);
    }
    setHasPassword(true);
    onSaved();
  }

  return (
    <form onSubmit={submit} className='grid gap-4' noValidate>
      {header}
      {askCurrent && (
        <div className='grid gap-2'>
          <Label htmlFor='current-password'>Mot de passe actuel</Label>
          <Input
            id='current-password'
            type='password'
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete='current-password'
            autoFocus
          />
        </div>
      )}
      <div className='grid gap-2'>
        <Label htmlFor='new-password'>Nouveau mot de passe (au moins {minLength} caractères)</Label>
        <Input
          id='new-password'
          type='password'
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          autoComplete='new-password'
          autoFocus={!askCurrent}
        />
      </div>
      <div className='grid gap-2'>
        <Label htmlFor='confirm-password'>Le même, une seconde fois</Label>
        <Input
          id='confirm-password'
          type='password'
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete='new-password'
        />
      </div>
      <ErrorMessage message={message} />
      <Actions className={inDialog ? undefined : 'flex flex-wrap justify-end gap-2'}>
        {otherActions}
        <Button type='submit' disabled={sending}>
          {sending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </Actions>
    </form>
  );
}

type ChangeProps = { hadPassword: boolean; isAdmin: boolean; onRemove: () => void; onClose: () => void };

function ChangePasswordDialog({ hadPassword, isAdmin, onRemove, onClose }: ChangeProps) {
  const [done, setDone] = useState(false);
  const title = hadPassword ? 'Changer le mot de passe' : 'Ajouter un mot de passe';
  if (done) {
    return (
      <DoneDialog title={title} onClose={onClose}>
        {hadPassword
          ? 'Votre mot de passe est changé. Vos autres appareils sont déconnectés.'
          : 'Votre mot de passe est enregistré : il vous sera demandé à chaque connexion. Vos autres appareils sont déconnectés.'}
      </DoneDialog>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <NewPasswordForm
          inDialog
          askCurrent={hadPassword}
          minLength={isAdmin ? MIN_ADMIN_PASSWORD_LENGTH : MIN_MEMBER_PASSWORD_LENGTH}
          onSaved={() => setDone(true)}
          header={
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>
                {hadPassword
                  ? 'Il est demandé à chaque connexion, après la date de naissance.'
                  : 'Facultatif. Pour mieux protéger votre compte, il sera demandé à chaque connexion, après la date de naissance.'}{' '}
                {isAdmin
                  ? 'C’est aussi celui qui ouvre l’administration.'
                  : 'Notez-le bien : en cas d’oubli, seul un responsable du club peut le retirer.'}
              </DialogDescription>
            </DialogHeader>
          }
          otherActions={
            <>
              {hadPassword && !isAdmin && (
                <Button type='button' variant='ghost' className='sm:mr-auto' onClick={onRemove}>
                  Retirer le mot de passe
                </Button>
              )}
              <Button type='button' variant='outline' onClick={onClose}>
                Annuler
              </Button>
            </>
          }
        />
      </DialogContent>
    </Dialog>
  );
}

function RemovePasswordDialog({ onClose }: { onClose: () => void }) {
  const { setHasPassword, sessionExpired } = useSession();
  const [currentPassword, setCurrentPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!currentPassword) return setMessage('Merci de taper votre mot de passe actuel.');
    setSending(true);
    const body: RemoveMemberPasswordRequest = { currentPassword };
    const result = await api(API_ROUTES.myPassword, { method: 'DELETE', body });
    setSending(false);
    if (!result.ok) {
      if (result.error === 'not_signed_in') return sessionExpired();
      return setMessage(ERROR_MESSAGES[result.error]);
    }
    setHasPassword(false);
    setDone(true);
  }

  if (done) {
    return (
      <DoneDialog title='Retirer le mot de passe' onClose={onClose}>
        Votre mot de passe est retiré : la date de naissance suffit de nouveau pour vous connecter.
      </DoneDialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className='grid gap-4' noValidate>
          <DialogHeader>
            <DialogTitle>Retirer le mot de passe ?</DialogTitle>
            <DialogDescription>
              La connexion ne demandera plus que le numéro de licence et la date de naissance.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='remove-password'>Mot de passe actuel</Label>
            <Input
              id='remove-password'
              type='password'
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete='current-password'
              autoFocus
            />
          </div>
          <ErrorMessage message={message} />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Non, le garder
            </Button>
            <Button type='submit' disabled={sending}>
              {sending ? 'Vérification…' : 'Oui, le retirer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
      {message}
    </p>
  );
}

function DoneDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p role='status' className='rounded-md bg-green-50 px-3 py-2 text-green-900'>
          {children}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
