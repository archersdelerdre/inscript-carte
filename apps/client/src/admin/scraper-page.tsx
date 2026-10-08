import {
  API_ROUTES,
  type ScraperReport,
  type ScraperRunDto,
  type ScraperStatusResponse,
  type StartScraperRunRequest,
  type StartScraperRunResponse,
} from '@inscript-carte/shared';
import { cn } from 'cn';
import { CheckIcon, CircleAlertIcon, LoaderCircleIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useCompetitions } from '@/competitions/use-competitions';
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
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { formatDateRange, formatDateTime } from '@/lib/dates';
import { ERROR_MESSAGES } from '@/registrations/messages';

import { CompetitionSearch } from './competition-search';
import { useScraperStatus } from './use-scraper-status';

/** Measured on 2026-10-08: a list page or a detail page takes about a second (with the polite pause). */
const SECONDS_PER_PAGE = 1.05;
const SECONDS_PER_DETAIL = 1.1;
/** About 5 s each (download, page images, LLM), three at a time. */
const SECONDS_PER_MANDATE = 2;
/** Until a full run has finished here, the FFTA list had about this many pages. */
const USUAL_LIST_PAGES = 75;

const count = new Intl.NumberFormat('fr-FR');

const mandatesRead = (n: number) => `${count.format(n)} ${n > 1 ? 'mandats lus' : 'mandat lu'}`;
const mandatesToRetry = (n: number) => `${count.format(n)} ${n > 1 ? 'mandats à relire' : 'mandat à relire'}`;
/** 45 000 → "45 s", 129 000 → "2 min 09 s", 2 040 000 → "34 min", 4 320 000 → "1 h 12 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  // Past 10 minutes the seconds are noise (and the estimate is not that precise).
  if (minutes < 10) return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "27469", "https://www.ffta.fr/epreuve/27469" or ".../index.php/epreuve/27469" → "27469"; `null` otherwise. */
export function fftaIdFrom(text: string): string | null {
  const trimmed = text.trim();
  if (/^\d{1,9}$/.test(trimmed)) return trimmed;
  return /\/epreuve\/(\d{1,9})/.exec(trimmed)?.[1] ?? null;
}

/** Re-renders every second while `active`, for the elapsed time. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

type Props = { onSessionExpired: () => void };

/** The FFTA calendar: last update, a live view of the one going on, and buttons to start one. */
export function ScraperPage({ onSessionExpired }: Props) {
  const { status, showRun } = useScraperStatus(onSessionExpired);
  const [message, setMessage] = useState<string | null>(null);

  async function start(request: StartScraperRunRequest): Promise<boolean> {
    setMessage(null);
    const result = await api<StartScraperRunResponse>(API_ROUTES.adminScraperRuns, { method: 'POST', body: request });
    if (result.ok) {
      showRun(result.data.run);
      return true;
    }
    if (result.error === 'admin_sign_in_required') onSessionExpired();
    else setMessage(ERROR_MESSAGES[result.error]);
    return false;
  }

  if (!status) return <p className='text-muted-foreground p-4'>Chargement…</p>;
  const lastFull = status.recent.find((run) => run.kind === 'full' && run.status === 'succeeded');
  const latest = status.recent[0];

  return (
    <div className='mx-auto grid max-w-3xl gap-6 p-4'>
      <header className='grid gap-1'>
        <h1 className='text-xl font-semibold tracking-tight'>Calendrier FFTA</h1>
        <p className='text-muted-foreground'>
          Chaque nuit à 3 h, l’application relit le calendrier du site de la FFTA : nouveaux concours, dates,
          annulations, mandats.
        </p>
      </header>

      {!status.available && (
        <p role='alert' className='rounded-lg bg-amber-50 px-4 py-3 text-amber-900'>
          {ERROR_MESSAGES.scraper_unavailable}
        </p>
      )}
      {message && (
        <p role='alert' className='rounded-lg bg-amber-50 px-4 py-3 text-amber-900'>
          {message}
        </p>
      )}

      {status.current ? (
        <CurrentRun run={status.current} listPages={lastFull?.report?.pages ?? USUAL_LIST_PAGES} />
      ) : (
        latest && <LatestRun run={latest} />
      )}

      {status.available && <StartButtons busy={status.current !== null} firstRun={!lastFull} onStart={start} />}

      {status.recent.length > 0 && <History runs={status.recent} />}
    </div>
  );
}

const STEPS = [
  { step: 'list', label: 'Lecture du calendrier' },
  { step: 'details', label: 'Lecture des fiches des concours à mettre à jour' },
  { step: 'saving', label: 'Enregistrement' },
  { step: 'mandates', label: 'Lecture des nouveaux mandats' },
] as const;

/** The run going on, for every admin with the page open: its steps, progress, time spent and left. */
function CurrentRun({ run, listPages }: { run: ScraperRunDto; listPages: number }) {
  const now = useNow(true);
  const elapsed = now - new Date(run.startedAt).getTime();
  const progress = run.progress;
  // A run for one competition only reads its detail page, which is its first step.
  const steps = run.kind === 'competition' ? STEPS.slice(1) : STEPS;
  const firstStep = STEPS.indexOf(steps[0]!);
  const stepIndex = progress ? STEPS.findIndex(({ step }) => step === progress.step) : firstStep;

  let remaining: number | null = null;
  if (progress?.step === 'list') remaining = Math.max(listPages - progress.page, 0) * SECONDS_PER_PAGE * 1000;
  if (progress?.step === 'details') remaining = (progress.total - progress.done) * SECONDS_PER_DETAIL * 1000;
  if (progress?.step === 'mandates') remaining = (progress.total - progress.done) * SECONDS_PER_MANDATE * 1000;

  return (
    <section aria-labelledby='current-run' className='bg-card grid gap-4 rounded-xl border-2 border-sky-300 p-4'>
      <div className='grid gap-1'>
        <h2 id='current-run' className='flex items-center gap-2 text-lg font-semibold'>
          <span aria-hidden className='relative flex size-3'>
            <span className='absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75' />
            <span className='relative inline-flex size-3 rounded-full bg-sky-500' />
          </span>
          {run.kind === 'competition'
            ? `Mise à jour du concours ${run.fftaId} en cours`
            : 'Mise à jour du calendrier en cours'}
        </h2>
        <p className='text-muted-foreground'>
          {run.startedByName ? `Lancée par ${run.startedByName}` : 'Lancée automatiquement'} le{' '}
          {formatDateTime(run.startedAt)} · depuis {formatDuration(elapsed)}
          {remaining !== null && remaining > 0 && ` · encore environ ${formatDuration(remaining)}`}
        </p>
      </div>

      <ol className='grid gap-3' aria-live='polite'>
        {steps.map(({ step, label: stepLabel }) => {
          const index = STEPS.findIndex((candidate) => candidate.step === step);
          const state = stepState(index, stepIndex);
          const label =
            run.kind === 'competition' && step === 'details' ? 'Lecture de la fiche du concours' : stepLabel;
          return (
            <li key={step} className='grid gap-1.5'>
              <div className={cn('flex items-center gap-2', state === 'waiting' && 'text-muted-foreground')}>
                {state === 'done' && <CheckIcon className='size-5 text-green-700' aria-hidden />}
                {state === 'current' && <LoaderCircleIcon className='size-5 animate-spin text-sky-600' aria-hidden />}
                {state === 'waiting' && (
                  <span aria-hidden className='border-muted-foreground/40 size-5 rounded-full border-2' />
                )}
                <span className={cn(state === 'current' && 'font-medium')}>{label}</span>
                {state === 'current' && progress?.step === 'list' && (
                  <span className='text-muted-foreground ml-auto text-sm'>
                    page {progress.page} · {count.format(progress.found)} concours
                  </span>
                )}
                {state === 'current' && (progress?.step === 'details' || progress?.step === 'mandates') && (
                  <span className='text-muted-foreground ml-auto text-sm'>
                    {count.format(progress.done)} / {count.format(progress.total)}
                  </span>
                )}
              </div>
              {state === 'current' && progress?.step === 'list' && (
                <ProgressBar value={progress.page} max={Math.max(listPages, progress.page)} label={label} />
              )}
              {state === 'current' &&
                (progress?.step === 'details' || progress?.step === 'mandates') &&
                progress.total > 0 && <ProgressBar value={progress.done} max={progress.total} label={label} />}
            </li>
          );
        })}
      </ol>

      <p className='text-muted-foreground text-sm'>
        Vous pouvez fermer cette page : la mise à jour continue sur le serveur. Les autres administrateurs la voient
        aussi.
      </p>
    </section>
  );
}

function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <div
      role='progressbar'
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className='bg-muted h-2.5 overflow-hidden rounded-full'
    >
      <div
        className='h-full rounded-full bg-sky-500 transition-[width] duration-500'
        style={{ width: `${(value / max) * 100}%` }}
      />
    </div>
  );
}

/** "1 857 concours lus · 12 nouveaux · …": only what is not zero, in plain words. */
function reportSummary(report: ScraperReport): string {
  const parts = [
    report.listed > 0 && `${count.format(report.listed)} concours lus`,
    report.added > 0 && `${count.format(report.added)} nouveau${report.added > 1 ? 'x' : ''}`,
    report.changed > 0 && `${count.format(report.changed)} modifié${report.changed > 1 ? 's' : ''}`,
    report.missing > 0 && `${count.format(report.missing)} disparu${report.missing > 1 ? 's' : ''} du calendrier FFTA`,
    report.detailsLeft > 0 && `${count.format(report.detailsLeft)} fiches restent à lire`,
    report.positions.notFound > 0 && `${count.format(report.positions.notFound)} sans position sur la carte`,
    report.mandates && report.mandates.read > 0 && mandatesRead(report.mandates.read),
    report.mandates &&
      report.mandates.failed + report.mandates.invalid > 0 &&
      mandatesToRetry(report.mandates.failed + report.mandates.invalid),
  ];
  return parts.filter(Boolean).join(' · ') || 'Rien n’a changé';
}

/** "Dernière mise à jour réussie le …", "La mise à jour du … a échoué / a été interrompue". */
function latestRunTitle(run: ScraperRunDto): string {
  if (run.status === 'succeeded')
    return `Dernière mise à jour réussie le ${formatDateTime(run.finishedAt ?? run.startedAt)}`;
  const outcome = run.status === 'interrupted' ? 'a été interrompue' : 'a échoué';
  return `La mise à jour du ${formatDateTime(run.startedAt)} ${outcome}`;
}

function LatestRun({ run }: { run: ScraperRunDto }) {
  const failed = run.status !== 'succeeded';
  return (
    <section
      aria-label='Dernière mise à jour'
      className={cn(
        'grid gap-1 rounded-xl px-4 py-3',
        failed ? 'bg-red-50 text-red-950' : 'bg-green-50 text-green-950',
      )}
    >
      <p className='flex items-center gap-2 font-medium'>
        {failed ? <CircleAlertIcon className='size-5' aria-hidden /> : <CheckIcon className='size-5' aria-hidden />}
        {latestRunTitle(run)}
      </p>
      {run.error && <p>{run.error}</p>}
      {run.report && !run.error && <p>{reportSummary(run.report)}</p>}
      {run.report && run.report.problems.length > 0 && <ReportProblems problems={run.report.problems} />}
    </section>
  );
}

/** Problems are rare and short; past a few the list is noise, the count is enough. */
const SHOWN_PROBLEMS = 5;

function ReportProblems({ problems }: { problems: string[] }) {
  const hidden = problems.length - SHOWN_PROBLEMS;
  return (
    <div className='grid gap-1'>
      <p className='font-medium'>{problems.length > 1 ? 'Points à vérifier :' : 'Point à vérifier :'}</p>
      <ul className='grid list-disc gap-1 pl-5'>
        {problems.slice(0, SHOWN_PROBLEMS).map((problem) => (
          <li key={problem}>{problem}</li>
        ))}
      </ul>
      {hidden > 0 && <p className='text-muted-foreground'>Et {hidden > 1 ? `${hidden} autres` : 'un autre'}.</p>}
    </div>
  );
}

type StartButtonsProps = {
  busy: boolean;
  firstRun: boolean;
  onStart: (request: StartScraperRunRequest) => Promise<boolean>;
};

function StartButtons({ busy, firstRun, onStart }: StartButtonsProps) {
  const [confirming, setConfirming] = useState(false);
  const [competitionsState] = useCompetitions();
  const competitions = competitionsState.kind === 'loaded' ? competitionsState.competitions : [];
  // The field always holds what is sent: picking a suggestion writes its FFTA number.
  const [competitionText, setCompetitionText] = useState('');
  const [competitionError, setCompetitionError] = useState<string | null>(null);
  const fftaId = fftaIdFrom(competitionText);
  const known = fftaId ? competitions.find((competition) => competition.id === fftaId) : undefined;

  function startOne(event: React.FormEvent) {
    event.preventDefault();
    if (!fftaId) {
      setCompetitionError(
        'Choisissez un concours dans la liste, ou collez son numéro ou le lien de sa fiche sur le site de la FFTA.',
      );
      return;
    }
    setCompetitionError(null);
    void onStart({ kind: 'competition', fftaId }).then((started) => started && setCompetitionText(''));
  }

  return (
    <div className='grid gap-4 sm:grid-cols-2'>
      <section className='bg-card grid content-between gap-3 rounded-xl border p-4'>
        <div className='grid gap-1'>
          <h2 className='font-semibold'>Tout le calendrier</h2>
          <p className='text-muted-foreground text-sm'>Relit tout le calendrier de la FFTA.</p>
          <p className='flex items-center gap-1.5 text-sm font-medium text-amber-800'>
            <TriangleAlertIcon className='size-4 shrink-0' aria-hidden />À ne faire qu’en cas de vrai besoin.
          </p>
        </div>
        <Button variant='outline' disabled={busy} onClick={() => setConfirming(true)}>
          <RefreshCwIcon />
          {busy ? 'Une mise à jour est en cours' : 'Mettre à jour tout le calendrier'}
        </Button>
      </section>

      <form onSubmit={startOne} className='bg-card grid content-between gap-3 rounded-xl border p-4'>
        <div className='grid gap-2'>
          <h2 className='font-semibold'>Un seul concours</h2>
          <Label htmlFor='scraper-competition' className='text-muted-foreground text-sm font-normal'>
            Nom, ville ou numéro du concours, ou lien vers sa fiche sur le site de la FFTA (quelques secondes)
          </Label>
          <CompetitionSearch
            id='scraper-competition'
            value={competitionText}
            placeholder='Ex. : Carquefou'
            invalid={competitionError !== null}
            competitions={competitions}
            onType={setCompetitionText}
            onPick={(competition) => {
              setCompetitionText(competition.id);
              setCompetitionError(null);
            }}
          />
          {known && (
            <p className='text-muted-foreground text-sm'>
              {known.title} · {formatDateRange(known.startDate, known.endDate)} · {known.town}
            </p>
          )}
          {competitionError && <p className='text-destructive text-sm'>{competitionError}</p>}
        </div>
        <Button type='submit' disabled={busy}>
          <RefreshCwIcon />
          Mettre à jour ce concours
        </Button>
      </form>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mettre à jour tout le calendrier ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <ul className='grid list-disc gap-1 pl-5 text-left'>
                <li>
                  L’application lit tout le calendrier du site de la FFTA, page par page, sans le surcharger :{' '}
                  {firstRun ? 'la première fois, environ 40 minutes' : 'environ 2 à 3 minutes'}.
                </li>
                <li>Une seule mise à jour à la fois : les autres administrateurs verront qu’elle est en cours.</li>
                <li>Vous pouvez fermer la page : la mise à jour continue sur le serveur.</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onStart({ kind: 'full' })}>Lancer la mise à jour</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const STATUS_LABELS: Record<ScraperRunDto['status'], { label: string; className: string }> = {
  running: { label: 'En cours', className: 'bg-sky-100 text-sky-900' },
  succeeded: { label: 'Réussie', className: 'bg-green-100 text-green-900' },
  failed: { label: 'Échouée', className: 'bg-red-100 text-red-900' },
  interrupted: { label: 'Interrompue', className: 'bg-amber-100 text-amber-900' },
};

function History({ runs }: { runs: ScraperStatusResponse['recent'] }) {
  return (
    <section aria-labelledby='scraper-history' className='grid gap-2'>
      <h2 id='scraper-history' className='font-semibold'>
        Dernières mises à jour
      </h2>
      <ul className='bg-card divide-y rounded-xl border'>
        {runs.map((run) => {
          const duration = run.finishedAt && new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
          return (
            <li key={run.id} className='grid gap-1 px-4 py-3'>
              <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                <span className='font-medium'>{formatDateTime(run.startedAt)}</span>
                <Badge className={STATUS_LABELS[run.status].className}>{STATUS_LABELS[run.status].label}</Badge>
                <span className='text-muted-foreground text-sm'>
                  {run.kind === 'competition' ? `Concours ${run.fftaId}` : 'Tout le calendrier'} ·{' '}
                  {run.startedByName ?? 'automatique'}
                  {duration ? ` · ${formatDuration(duration)}` : ''}
                </span>
              </div>
              <p className='text-muted-foreground text-sm'>
                {run.error ?? (run.report ? reportSummary(run.report) : '')}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function stepState(index: number, current: number): 'done' | 'current' | 'waiting' {
  if (index < current) return 'done';
  return index === current ? 'current' : 'waiting';
}
