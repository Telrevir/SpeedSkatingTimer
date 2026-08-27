export function formatCentiseconds(centiseconds: number): string {
  if (centiseconds < 0) return '—'
  const minutes = Math.floor(centiseconds / 6000)
  const seconds = Math.floor((centiseconds % 6000) / 100)
  const hundredths = centiseconds % 100
  return `${pad2(minutes)}:${pad2(seconds)}.${pad2(hundredths)}`
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}
