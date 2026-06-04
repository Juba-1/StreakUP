export function hapticTap() {
  try {
    navigator.vibrate?.(10)
  } catch {
    /* ignore */
  }
}

export function hapticSuccess() {
  try {
    navigator.vibrate?.([18, 24, 18, 32, 22])
  } catch {
    /* ignore */
  }
}

export function hapticError() {
  try {
    navigator.vibrate?.([40, 30, 60])
  } catch {
    /* ignore */
  }
}
