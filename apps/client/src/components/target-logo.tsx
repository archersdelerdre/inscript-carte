/** The favicon's target (same rings and colors as in `index.html`), for the app header. */
export function TargetLogo({ className }: { className?: string }) {
  return (
    <svg viewBox='0 0 32 32' aria-hidden className={className}>
      <circle cx='16' cy='16' r='15.5' fill='white' stroke='#444' />
      <circle cx='16' cy='16' r='12.5' fill='#222' />
      <circle cx='16' cy='16' r='9.5' fill='#00a0e3' />
      <circle cx='16' cy='16' r='6.5' fill='#e3262b' />
      <circle cx='16' cy='16' r='3.5' fill='#ffe100' />
    </svg>
  );
}
