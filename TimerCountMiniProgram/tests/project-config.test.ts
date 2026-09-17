import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('maps root npm dependencies into the miniprogram source directory', () => {
  const config = JSON.parse(readFileSync('project.config.json', 'utf8')) as {
    setting: {
      packNpmManually: boolean
      packNpmRelationList: Array<{ packageJsonPath: string; miniprogramNpmDistDir: string }>
    }
  }

  assert.equal(config.setting.packNpmManually, true)
  assert.deepEqual(config.setting.packNpmRelationList, [{
    packageJsonPath: './package.json',
    miniprogramNpmDistDir: './miniprogram/',
  }])
})
