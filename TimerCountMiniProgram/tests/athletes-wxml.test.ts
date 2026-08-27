import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const athletesWxml = readFileSync(
  'miniprogram/pages/athletes/index.wxml',
  'utf8',
)

test('keeps archived list iteration inside the wx:if branch', () => {
  assert.doesNotMatch(
    athletesWxml,
    /<view\b(?=[^>]*wx:if="\{\{archivedAthletes\.length\}\}")(?=[^>]*wx:for=)[^>]*>/,
  )
  assert.match(
    athletesWxml,
    /<block\s+wx:if="\{\{archivedAthletes\.length\}\}">\s*<view\b[^>]*wx:for="\{\{archivedAthletes\}\}"/,
  )
})
