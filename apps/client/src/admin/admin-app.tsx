import { API_ROUTES, type AdminSessionResponse } from '@inscript-carte/shared';
import { cn } from 'cn';
import { KeyRoundIcon, LogOutIcon, MapIcon, ShieldCheckIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { ERROR_MESSAGES } from '@/registrations/messages';

import { AdminCompetitions } from './admin-competitions';
import { ChangePasswordDialog, ForcedPasswordChange } from './change-password';
import { CompetitionsPage } from './competitions-page';
import { MembersPage } from './members-page';
import { ScraperPage } from './scraper-page';

type Admin = AdminSessionResponse['admin'];
type Section = 'registrations' | 'competitions' | 'members' | 'scraper';

/** Each section is a page with its own address, so it can be bookmarked, reloaded and opened in a new tab. */
const SECTIONS: Record<Section, { path: string; title: string }> = {
  registrations: { path: '/admin/inscriptions', title: 'Inscriptions' },
  competitions: { path: '/admin/concours', title: 'Concours' },
  members: { path: '/admin/licencies', title: 'Licenciés' },
  scraper: { path: '/admin/calendrier', title: 'Calendrier FFTA' },
};

/** `/admin` and unknown admin paths show the registrations. */
function sectionFromPath(pathname: string): Section {
  const found = (Object.keys(SECTIONS) as Section[]).find((section) => pathname.startsWith(SECTIONS[section].path));
  return found ?? 'registrations';
}

/** `/admin/inscriptions/26492` → `26492`: the competition open on the registrations page. */
function competitionFromPath(pathname: string): string | null {
  const match = /^\/admin\/inscriptions\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** The club secretary's pages, under `/admin`. The address says which page and which competition are open. */
export function AdminApp() {
  /** `undefined` while the first check runs. */
  const [admin, setAdmin] = useState<Admin | null | undefined>(undefined);
  const [pathname, setPathname] = useState(normalizedPathname);
  const [expired, setExpired] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  /** Signed in, with their own password: the panel is open. */
  const ready = admin && !admin.mustChangePassword;
  const section = sectionFromPath(pathname);
  const competitionId = section === 'registrations' ? competitionFromPath(pathname) : null;

  useEffect(() => {
    void api<AdminSessionResponse>(API_ROUTES.adminSession).then((result) =>
      setAdmin(result.ok ? result.data.admin : null),
    );
    // The browser's back and forward buttons change the page, or the competition shown.
    const onPopState = () => setPathname(location.pathname);
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    document.title = `${SECTIONS[section].title} – Administration du club`;
  }, [section]);

  // Stable identity: the competitions page passes it down to its list.
  const navigate = useCallback((path: string) => {
    if (path === location.pathname) return;
    history.pushState(null, '', path);
    setPathname(path);
  }, []);
  const selectCompetition = useCallback(
    (id: string | null) =>
      navigate(id === null ? SECTIONS.registrations.path : `${SECTIONS.registrations.path}/${encodeURIComponent(id)}`),
    [navigate],
  );

  // Stable identity: screens use it in their effects.
  const sessionExpired = useCallback(() => {
    setExpired(true);
    setAdmin(null);
  }, []);

  async function signOut() {
    await api(API_ROUTES.adminSession, { method: 'DELETE' });
    setExpired(false);
    setAdmin(null);
  }

  return (
    <div className='flex h-svh flex-col'>
      <header className='flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2'>
        <ShieldCheckIcon className='text-primary size-6 shrink-0' />
        <span className='min-w-0 truncate text-lg font-semibold tracking-tight'>Administration</span>
        {ready && (
          <nav className='flex flex-wrap gap-1' aria-label='Rubriques'>
            <SectionLink section='registrations' active={section === 'registrations'} onNavigate={navigate} />
            <SectionLink section='competitions' active={section === 'competitions'} onNavigate={navigate} />
            <SectionLink section='members' active={section === 'members'} onNavigate={navigate} />
            <SectionLink section='scraper' active={section === 'scraper'} onNavigate={navigate} />
          </nav>
        )}
        <div className='ml-auto flex items-center gap-2'>
          <Button variant='ghost' asChild>
            <a href='/'>
              <MapIcon />
              <span className='max-sm:sr-only'>Retour à la carte</span>
            </a>
          </Button>
          {ready && (
            <Button variant='ghost' onClick={() => setChangingPassword(true)}>
              <KeyRoundIcon />
              <span className='max-sm:sr-only'>Mot de passe</span>
            </Button>
          )}
          {admin && (
            <Button variant='outline' onClick={() => void signOut()} title={`Connecté : ${admin.fullName}`}>
              <LogOutIcon />
              <span className='max-sm:sr-only'>Se déconnecter</span>
            </Button>
          )}
        </div>
      </header>

      {admin === undefined && <p className='text-muted-foreground p-4'>Chargement…</p>}
      {admin === null && (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <AdminSignIn
            expired={expired}
            onSignedIn={(signedIn) => {
              setExpired(false);
              setAdmin(signedIn);
            }}
          />
        </div>
      )}
      {admin?.mustChangePassword && (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <ForcedPasswordChange
            onChanged={() => setAdmin({ ...admin, mustChangePassword: false })}
            onSessionExpired={sessionExpired}
          />
        </div>
      )}
      {ready && section === 'registrations' && (
        <AdminCompetitions selectedId={competitionId} onSelect={selectCompetition} onSessionExpired={sessionExpired} />
      )}
      {ready && section === 'competitions' && (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <CompetitionsPage
            onOpenRegistrations={selectCompetition}
            onOpenScraper={() => navigate(SECTIONS.scraper.path)}
            onSessionExpired={sessionExpired}
          />
        </div>
      )}
      {ready && section === 'members' && (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <MembersPage currentLicenceNumber={admin.licenceNumber} onSessionExpired={sessionExpired} />
        </div>
      )}
      {ready && section === 'scraper' && (
        <div className='min-h-0 flex-1 overflow-y-auto'>
          <ScraperPage onSessionExpired={sessionExpired} />
        </div>
      )}
      {changingPassword && (
        <ChangePasswordDialog onClose={() => setChangingPassword(false)} onSessionExpired={sessionExpired} />
      )}
    </div>
  );
}

type SectionLinkProps = { section: Section; active: boolean; onNavigate: (path: string) => void };

/** A real link: a plain click changes the page without reloading, Ctrl/Cmd/middle click opens a new tab. */
function SectionLink({ section, active, onNavigate }: SectionLinkProps) {
  return (
    <Button variant={active ? 'secondary' : 'ghost'} className={cn(active && 'font-semibold')} asChild>
      <a
        href={SECTIONS[section].path}
        aria-current={active ? 'page' : undefined}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          onNavigate(SECTIONS[section].path);
        }}
      >
        {SECTIONS[section].title}
      </a>
    </Button>
  );
}

/** `/admin` alone (or an unknown admin path) becomes the address of the page it shows. Runs once, at start. */
function normalizedPathname(): string {
  const current = location.pathname;
  const known = Object.values(SECTIONS).some(({ path }) => current.startsWith(path));
  if (!known) history.replaceState(null, '', SECTIONS.registrations.path);
  return known ? current : SECTIONS.registrations.path;
}

/** Step 1: the member sign-in (licence + birth date). Step 2: the admin's personal password. */
function AdminSignIn({ expired, onSignedIn }: { expired: boolean; onSignedIn: (admin: Admin) => void }) {
  const { archer, withArcher, signOut } = useSession();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(expired ? ERROR_MESSAGES.admin_sign_in_required : null);
  const [sending, setSending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!password) return setMessage('Merci de taper votre mot de passe.');
    setSending(true);
    const result = await api<AdminSessionResponse>(API_ROUTES.adminSession, { method: 'POST', body: { password } });
    setSending(false);
    setPassword('');
    if (result.ok) return onSignedIn(result.data.admin);
    setMessage(result.error === 'invalid_credentials' ? 'Mot de passe incorrect.' : ERROR_MESSAGES[result.error]);
  }

  return (
    <main className='mx-auto grid w-full max-w-md gap-4 p-4 pt-10'>
      <h1 className='text-2xl font-semibold tracking-tight'>Espace du club</h1>
      <p className='text-muted-foreground'>
        Réservé aux responsables du club : suivi des inscriptions et des paiements.
      </p>

      {archer === undefined && <p className='text-muted-foreground'>Chargement…</p>}
      {archer === null && (
        <>
          <p>Connectez-vous d'abord avec votre numéro de licence et votre date de naissance.</p>
          <Button className='w-fit' onClick={() => withArcher(() => {})}>
            Se connecter
          </Button>
        </>
      )}
      {archer && (
        <form onSubmit={submit} className='grid gap-4' noValidate>
          <p>
            Connecté : <strong>{archer.fullName}</strong>.{' '}
            <button type='button' className='underline underline-offset-4' onClick={() => void signOut()}>
              Ce n'est pas vous ?
            </button>
          </p>
          {/* Lets password managers save the password with the licence number. */}
          <input type='hidden' name='username' autoComplete='username' value={archer.licenceNumber} readOnly />
          <div className='grid gap-2'>
            <Label htmlFor='admin-password'>Mot de passe administrateur</Label>
            <Input
              id='admin-password'
              type='password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete='current-password'
              autoFocus
            />
          </div>
          {message && (
            <p role='alert' className='rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900'>
              {message}
            </p>
          )}
          <Button type='submit' className='w-fit' disabled={sending}>
            {sending ? 'Vérification…' : 'Entrer'}
          </Button>
        </form>
      )}
    </main>
  );
}
