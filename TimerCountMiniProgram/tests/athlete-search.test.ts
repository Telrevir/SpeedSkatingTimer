import assert from 'node:assert/strict'
import test from 'node:test'

import { matchesAthleteSearch } from '../miniprogram/domain/athlete-search'

const athlete = { id: 3, name: '马浩阳', epc: '0000002D' }

test('matches an athlete by Chinese name, name-prefix pinyin, initials, and identifier', () => {
  for (const query of ['马浩阳', 'mahaoyang', 'mhy', '3']) {
    assert.equal(matchesAthleteSearch(athlete, query), true, query)
  }
  assert.equal(matchesAthleteSearch(athlete, '0000002D'), false)
})

test('does not match pinyin that starts from a later character in the name', () => {
  assert.equal(matchesAthleteSearch({ id: 35, name: '王俊懋', epc: '00000035' }, 'mao'), false)
})
