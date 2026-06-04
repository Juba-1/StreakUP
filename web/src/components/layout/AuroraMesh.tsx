/**
 * App-wide ambient backdrop: static gradients only — no animations, minimal compositing cost.
 */
export function AuroraMesh() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-20 overflow-hidden"
      aria-hidden
    >
      <div
        className="absolute inset-0 opacity-[0.42]"
        style={{
          background: `
            radial-gradient(82% 58% at 18% -5%, color-mix(in oklab, var(--brand-primary, #8b5cf6) 22%, transparent), transparent 72%),
            radial-gradient(75% 52% at 102% 8%, color-mix(in oklab, var(--brand-secondary, #fb923c) 16%, transparent), transparent 70%),
            radial-gradient(65% 40% at 48% 102%, color-mix(in oklab, var(--brand-primary, #7c3aed) 8%, transparent), transparent 55%)
          `,
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.75\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
          backgroundSize: '128px 128px',
        }}
      />
    </div>
  )
}
