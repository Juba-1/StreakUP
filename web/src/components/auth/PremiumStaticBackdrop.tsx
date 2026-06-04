/**
 * Zero-JS ambient layer: fixed gradients + subtle grain. No listeners, no RAF.
 */
export function PremiumStaticBackdrop({ className = '' }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden ${className}`}
      aria-hidden
    >
      <div
        className="absolute inset-0 opacity-[0.92]"
        style={{
          background: `
            radial-gradient(120% 80% at 12% 8%, color-mix(in oklab, var(--brand-primary, #a78bfa) 18%, transparent), transparent 58%),
            radial-gradient(90% 70% at 88% 12%, color-mix(in oklab, var(--brand-secondary, #fb923c) 14%, transparent), transparent 55%),
            radial-gradient(70% 50% at 50% 100%, color-mix(in oklab, var(--brand-primary, #a78bfa) 8%, transparent), transparent 45%),
            linear-gradient(165deg, oklch(0.12 0.02 280 / 0.97) 0%, oklch(0.09 0.01 260 / 1) 45%, oklch(0.11 0.015 300 / 1) 100%)
          `,
        }}
      />
      <div
        className="absolute inset-0 mix-blend-overlay opacity-[0.04]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 512 512\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'g\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23g)\'/%3E%3C/svg%3E")',
          backgroundSize: '256px 256px',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-12deg, transparent, transparent 1px, color-mix(in oklab, white 12%, transparent) 1px, color-mix(in oklab, white 12%, transparent) 2px)',
        }}
      />
    </div>
  )
}
