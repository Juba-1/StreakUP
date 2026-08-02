type Props = {
  values: number[]
  className?: string
  stroke?: string
  'aria-hidden'?: boolean
}

/** Tiny inline SVG sparkline — no chart library. */
export function MiniSparkline({ values, className, stroke = 'currentColor', ...rest }: Props) {
  const w = 72
  const h = 28
  const nums = values.length ? values : [0]
  const max = Math.max(...nums, 1)
  const min = Math.min(...nums, 0)
  const span = Math.max(max - min, 1)
  const pts = nums
    .map((v, i) => {
      const x = nums.length === 1 ? w / 2 : (i / (nums.length - 1)) * w
      const y = h - ((v - min) / span) * (h - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={className}
      role="presentation"
      {...rest}
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  )
}
