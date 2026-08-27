import assert from 'node:assert/strict'
import test from 'node:test'

import { formatCentiseconds } from '../miniprogram/domain/time-format'

test('formats centiseconds as minutes, seconds and hundredths', () => {
  assert.equal(formatCentiseconds(4050), '00:40.50')
  assert.equal(formatCentiseconds(62698), '10:26.98')
})

test('shows an em dash for an unknown time', () => {
  assert.equal(formatCentiseconds(-1), '—')
})
