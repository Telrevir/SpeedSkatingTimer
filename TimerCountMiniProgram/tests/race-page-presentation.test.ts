import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEmptyRankingSlots,
  getRaceNavigationTitle,
  isGroupCompact,
} from '../miniprogram/domain/race-page-presentation'

test('keeps the selected group compact while a race is running or when the temporary toggle is active', () => {
  assert.equal(isGroupCompact('idle', false), false)
  assert.equal(isGroupCompact('running', false), true)
  assert.equal(isGroupCompact('finishing', false), true)
  assert.equal(isGroupCompact('finished', false), true)
  assert.equal(isGroupCompact('idle', true), true)
})

test('formats the selected group in the race navigation title', () => {
  assert.equal(getRaceNavigationTitle('甲组'), '比赛（当前分组：甲组）')
  assert.equal(getRaceNavigationTitle(''), '比赛（当前分组：全部运动员）')
})

test('creates five empty ranking slots without athlete data', () => {
  assert.deepEqual(createEmptyRankingSlots(), [1, 2, 3, 4, 5])
})
