import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateLapCorrection } from '../miniprogram/domain/lap-correction-engine'

test('uses the arithmetic mean as the baseline after three stable real laps', () => {
  const result = evaluateLapCorrection({
    rawLapDelta: 1,
    observedCentiseconds: 5800,
    validLapCentiseconds: [2700, 3000, 3000],
  })

  assert.deepEqual(result, {
    addedLaps: 1,
    baselineCentiseconds: 2900,
    impliedLapCentiseconds: 2900,
    reason: 'auto-corrected',
  })
})
