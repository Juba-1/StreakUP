import { QRCode } from 'react-qr-code'

import { cn } from '@/lib/utils'

/** Matches Tailwind `size-44` (11rem ≈ 176px) minus `p-2` padding. */
const QR_PIXEL_SIZE = 160

type Props = {
  value: string
  className?: string
}

/** Local QR for customer portal URLs — no third-party image API. */
export function CustomerPortalQrCode({ value, className }: Props) {
  if (!value.trim()) return null

  return (
    <div
      className={cn(
        'flex size-44 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white p-2',
        className,
      )}
    >
      <QRCode value={value} size={QR_PIXEL_SIZE} level="M" bgColor="#ffffff" fgColor="#000000" />
    </div>
  )
}
