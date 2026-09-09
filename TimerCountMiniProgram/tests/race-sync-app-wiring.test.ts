import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

test('app service wiring delegates lifecycle execution through the bridge without module-load requests', () => {
  const source = readFileSync(resolve(process.cwd(), 'miniprogram/services/app-services.ts'), 'utf8')

  assert.match(source, /new RaceSyncScheduler\([\s\S]*execute: \(task\)[\s\S]*raceSyncService\.execute\(task\)/)
  assert.match(source, /new RaceSyncService\([\s\S]*request: \(endpoint, payload, task\) => workerRequestBridge\.request/)
  assert.match(source, /new WorkerRequestBridge\(backendClient\)/)
  assert.doesNotMatch(source, /wx\.request\s*\(/)
})
