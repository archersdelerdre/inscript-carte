import { API_ROUTES, type SessionResponse, type SignedInArcher } from '@inscript-carte/shared';
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

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
import { formatDateTyping, parseFrenchDate } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';

const LICENCE_STORAGE_KEY = 'licenceNumber';

type SessionContextValue = {
  /** `undefined` while the first check runs. */
  archer: SignedInArcher | null | undefined;
  /** Runs `action` with the signed-in archer, asking to sign in first if needed. */
  withArcher: (action: (archer: SignedInArcher) => void) => void;
  signOut: () => Promise<void>;
  /** After an API call answered `not_signed_in`: forget the archer. */
  sessionExpired: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = use(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [archer, setArcher] = useState<SignedInArcher | null | undefined>(undefined);
  const [signInOpen, setSignInOpen] = useState(false);
  const pendingAction = useRef<((archer: SignedInArcher) => void) | null>(null);

  useEffect(() => {
    void api<SessionResponse>(API_ROUTES.session).then((result) => setArcher(result.ok ? result.data.archer : null));
  }, []);

  const withArcher = useCallback(
    (action: (archer: SignedInArcher) => void) => {
      if (archer) return action(archer);
      pendingAction.current = action;
      setSignInOpen(true);
    },
    [archer],
  );

  // Stable identities: dialogs use them as effect dependencies.
  const signOut = useCallback(async () => {
    await api(API_ROUTES.session, { method: 'DELETE' });
    setArcher(null);
  }, []);
  const sessionExpired = useCallback(() => setArcher(null), []);

  const value = useMemo<SessionContextValue>(
    () => ({ archer, withArcher, signOut, sessionExpired }),
    [archer, withArcher, signOut, sessionExpired],
  );

  return (
    <SessionContext value={value}>
      {children}
      <SignInDialog
        open={signInOpen}
        onOpenChange={(open) => {
          setSignInOpen(open);
          if (!open) pendingAction.current = null;
        }}
        onSignedIn={(signedIn) => {
          setArcher(signedIn);
          setSignInOpen(false);
          const action = pendingAction.current;
          pendingAction.current = null;
          action?.(signedIn);
        }}
      />
    </SessionContext>
  );
}

type SignInDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignedIn: (archer: SignedInArcher) => void;
};

function SignInDialog({ open, onOpenChange, onSignedIn }: SignInDialogProps) {
  const [licenceNumber, setLicenceNumber] = useState(() => localStorage.getItem(LICENCE_STORAGE_KEY) ?? '');
  const [birthDate, setBirthDate] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const isoBirthDate = parseFrenchDate(birthDate);
    const missing = [
      !licenceNumber.trim() && 'votre numéro de licence',
      !isoBirthDate && 'votre date de naissance (jour/mois/année, par exemple 12/05/1980)',
    ].filter(Boolean);
    if (missing.length > 0) return setMessage(`Merci d'indiquer ${missing.join(' et ')}.`);

    setSending(true);
    const result = await api<SessionResponse>(API_ROUTES.session, {
      method: 'POST',
      body: { licenceNumber, birthDate: isoBirthDate },
    });
    setSending(false);
    if (!result.ok) return setMessage(ERROR_MESSAGES[result.error]);

    // The licence number is public, so it can stay on the device; the birth date never does.
    localStorage.setItem(LICENCE_STORAGE_KEY, result.data.archer.licenceNumber);
    setBirthDate('');
    setMessage(null);
    onSignedIn(result.data.archer);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className='grid gap-4' noValidate>
          <DialogHeader>
            <DialogTitle>Se connecter</DialogTitle>
            <DialogDescription>
              Réservé aux licenciés du club. Une seule fois sur cet appareil : il se souviendra de vous.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='licence-number'>Numéro de licence</Label>
            <Input
              id='licence-number'
              value={licenceNumber}
              onChange={(event) => setLicenceNumber(event.target.value)}
              placeholder='Par exemple 0123456A'
              autoComplete='username'
              autoCapitalize='characters'
            />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='birth-date'>Date de naissance</Label>
            <Input
              id='birth-date'
              value={birthDate}
              onChange={(event) => {
                const inputType = (event.nativeEvent as InputEvent).inputType ?? '';
                setBirthDate(formatDateTyping(event.target.value, inputType.startsWith('delete')));
              }}
              placeholder='JJ/MM/AAAA'
              maxLength={10}
              inputMode='numeric'
              autoComplete='bday'
            />
          </div>
          {message && (
            <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
              {message}
            </p>
          )}
          <DialogFooter>
            <Button type='submit' disabled={sending}>
              {sending ? 'Vérification…' : 'Se connecter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
