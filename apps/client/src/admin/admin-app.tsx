import { API_ROUTES, MIN_ADMIN_PASSWORD_LENGTH, type AdminSessionResponse } from '@inscript-carte/shared';
import { cn } from 'cn';
import { LogOutIcon, MapIcon, ShieldCheckIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { NewPasswordForm, PasswordButton } from '@/auth/password';
import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

import { AdminCompetitions } from './admin-competitions';
import { CompetitionsPage } from './competitions-page';
import { MembersPage } from './members-page';
import { ScraperPage } from './scraper-page';

type Admin = AdminSessionResponse['admin'];
type Section = 'registrations' | 'competitions' | 'members' | 'scraper';
/** Why the panel is closed, as the server says it. */
type Closed = 'not_signed_in' | 'not_admin' | 'password_required';
type Access = { kind: 'loading' } | { kind: 'open'; admin: Admin } | { kind: 'closed'; reason: Closed };

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

/**
 * The club secretary's pages, under `/admin`. One sign-in (2026-10-25): the site session, opened with the password,
 * opens the panel; there is no second step. The address says which page and which competition are open.
 */
export function AdminApp() {
  const { archer, signOut } = useSession();
  const [access, setAccess] = useState<Access>({ kind: 'loading' });
  const [pathname, setPathname] = useState(normalizedPathname);
  const section = sectionFromPath(pathname);
  const competitionId = section === 'registrations' ? competitionFromPath(pathname) : null;

  // Stable identity: screens call it in their effects when the server says the access ended.
  const checkAccess = useCallback(() => {
    void api<AdminSessionResponse>(API_ROUTES.adminSession).then((result) => {
      if (result.ok) return setAccess({ kind: 'open', admin: result.data.admin });
      const reason = result.error === 'not_admin' || result.error === 'password_required' ? result.error : null;
      setAccess({ kind: 'closed', reason: reason ?? 'not_signed_in' });
    });
  }, []);

  // Again after every site sign-in, sign-out or password change.
  const signedInAs = archer === undefined ? undefined : `${archer?.licenceNumber}:${archer?.hasPassword}`;
  useEffect(() => {
    if (signedInAs !== undefined) checkAccess();
  }, [signedInAs, checkAccess]);

  useEffect(() => {
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

  const admin = access.kind === 'open' ? access.admin : null;
  /** Signed in, with their own password: the panel is open. */
  const ready = admin !== null && !admin.mustChangePassword;

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
          {ready && <PasswordButton />}
          {admin && (
            <Button variant='outline' onClick={() => void signOut()} title={`Connecté : ${admin.fullName}`}>
              <LogOutIcon />
              <span className='max-sm:sr-only'>Se déconnecter</span>
            </Button>
          )}
        </div>
      </header>

      {access.kind === 'loading' && <p className='text-muted-foreground p-4'>Chargement…</p>}
      {access.kind === 'closed' && (
        <div className='bg-muted min-h-0 flex-1 overflow-y-auto'>
          <PanelClosed reason={access.reason} />
        </div>
      )}
      {admin?.mustChangePassword && (
        <div className='bg-muted min-h-0 flex-1 overflow-y-auto'>
          <ForcedPasswordChange onChanged={checkAccess} />
        </div>
      )}
      {ready && section === 'registrations' && (
        <AdminCompetitions selectedId={competitionId} onSelect={selectCompetition} onSessionExpired={checkAccess} />
      )}
      {ready && section === 'competitions' && (
        <div className='bg-muted min-h-0 flex-1 overflow-y-auto'>
          <CompetitionsPage
            onOpenRegistrations={selectCompetition}
            onOpenScraper={() => navigate(SECTIONS.scraper.path)}
            onSessionExpired={checkAccess}
          />
        </div>
      )}
      {ready && section === 'members' && (
        <div className='bg-muted min-h-0 flex-1 overflow-y-auto'>
          <MembersPage currentLicenceNumber={admin.licenceNumber} onSessionExpired={checkAccess} />
        </div>
      )}
      {ready && section === 'scraper' && (
        <div className='bg-muted min-h-0 flex-1 overflow-y-auto'>
          <ScraperPage onSessionExpired={checkAccess} />
        </div>
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

const CARD = 'bg-card mx-auto mt-10 grid w-[calc(100%-2rem)] max-w-md gap-4 rounded-xl border p-6 shadow-sm';

/** The panel is closed: says why, and the one thing to do. */
function PanelClosed({ reason }: { reason: Closed }) {
  const { archer, withArcher, signOut } = useSession();
  const signInAgain = () => void signOut().then(() => withArcher(() => {}));
  return (
    <main className={CARD}>
      <h1 className='text-2xl font-semibold tracking-tight'>Espace du club</h1>
      <p className='text-muted-foreground'>
        Réservé aux responsables du club : suivi des inscriptions et des paiements.
      </p>
      {reason === 'not_signed_in' && (
        <>
          <p>Connectez-vous avec votre numéro de licence, votre date de naissance et votre mot de passe.</p>
          <Button className='w-fit' onClick={() => withArcher(() => {})}>
            Se connecter
          </Button>
        </>
      )}
      {reason === 'password_required' && (
        <>
          <p>
            Vous êtes connecté{archer?.sex === 'female' ? 'e' : ''} sans votre mot de passe. Pour ouvrir
            l’administration, reconnectez-vous avec lui.
          </p>
          <Button className='w-fit' onClick={signInAgain}>
            Se reconnecter
          </Button>
        </>
      )}
      {reason === 'not_admin' && (
        <>
          <p>Vous n’avez pas accès à l’administration du club.</p>
          <Button variant='outline' className='w-fit' onClick={signInAgain}>
            Se connecter avec un autre compte
          </Button>
        </>
      )}
    </main>
  );
}

/** First sign-in with a password generated by another admin: nothing else is shown until it is replaced. */
function ForcedPasswordChange({ onChanged }: { onChanged: () => void }) {
  return (
    <main className={CARD}>
      <h1 className='text-2xl font-semibold tracking-tight'>Choisissez votre mot de passe</h1>
      <p className='text-muted-foreground'>
        Vous vous êtes connecté avec le mot de passe donné par un autre responsable. Pour la sécurité du club,
        choisissez maintenant un mot de passe que vous seul connaissez. Il servira pour le site et pour
        l’administration.
      </p>
      <NewPasswordForm askCurrent={false} minLength={MIN_ADMIN_PASSWORD_LENGTH} inDialog={false} onSaved={onChanged} />
    </main>
  );
}
