/** Brand-immersed glass surfaces for the customer portal (no generic black/zinc). */

export const portalMeshBg = {
  background: `
    radial-gradient(120% 80% at 10% -5%, color-mix(in oklab, var(--brand-primary) 28%, transparent), transparent 52%),
    radial-gradient(90% 70% at 95% 15%, color-mix(in oklab, var(--brand-secondary) 22%, transparent), transparent 48%),
    radial-gradient(70% 50% at 50% 100%, color-mix(in oklab, var(--brand-primary) 16%, transparent), transparent 55%),
    linear-gradient(168deg,
      color-mix(in oklab, var(--brand-primary) 9%, #faf9fc 91%),
      color-mix(in oklab, var(--brand-secondary) 12%, #f5f1fa 93%) 42%,
      color-mix(in oklab, var(--brand-primary) 10%, #eee9f8 90%) 100%)
  `,
} as const

export const portalGlassPanel =
  'relative overflow-hidden rounded-[1.75rem] border border-[color-mix(in_oklab,var(--brand-primary)_28%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_10%,white_72%)] shadow-[0_28px_90px_-40px_var(--brand-glow)] backdrop-blur-2xl'

export const portalGlassPanelDark =
  'relative overflow-hidden rounded-[1.75rem] border border-[color-mix(in_oklab,var(--brand-primary)_35%,white)] bg-[color-mix(in_oklab,var(--brand-primary)_22%,#120a1f_78%)] text-white shadow-[0_32px_100px_-45px_var(--brand-glow)] backdrop-blur-2xl'

export const portalTextPrimary = 'text-[color-mix(in_oklab,#1a1030_88%,var(--brand-primary))]'
export const portalTextMuted = 'text-[color-mix(in_oklab,#1a1030_55%,var(--brand-secondary))]'
