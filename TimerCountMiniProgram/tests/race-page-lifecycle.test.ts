import assert from 'node:assert/strict'
import test from 'node:test'

interface RacePageDefinition {
  data: Record<string, unknown>
  onLoad(this: PageHarness): void
  onShow(this: PageHarness): void
  onUnload(): void
}

class PageHarness {
  data: Record<string, unknown>

  constructor(initial: Record<string, unknown>) {
    this.data = structuredClone(initial)
  }

  setData(patch: Record<string, unknown>): void {
    Object.assign(this.data, patch)
  }
}

test('race page restores the selected group title when returning from athletes', () => {
  const storage = new Map<string, unknown>()
  const titles: string[] = []
  let definition: RacePageDefinition | null = null
  const globals = globalThis as unknown as {
    Page: (candidate: RacePageDefinition) => void
    wx: Record<string, unknown>
  }
  globals.wx = {
    getStorageSync: (key: string) => storage.get(key) ?? '',
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    setNavigationBarTitle: ({ title }: { title: string }) => titles.push(title),
    onBLECharacteristicValueChange: () => undefined,
    onBLEConnectionStateChange: () => undefined,
  }
  globals.Page = (candidate) => { definition = candidate }

  require('../miniprogram/pages/race/index')
  assert.ok(definition)
  const captured = definition as unknown as RacePageDefinition
  const page = Object.assign(new PageHarness(captured.data), captured)
  captured.onLoad.call(page)

  const { groupStore, raceController } = require('../miniprogram/services/app-services') as typeof import('../miniprogram/services/app-services')
  const group = groupStore.create('甲组', [1])
  groupStore.select(group.id)
  titles.length = 0
  const originalAutoConnect = raceController.autoConnect
  raceController.autoConnect = async () => undefined

  try {
    captured.onShow.call(page)
    assert.deepEqual(titles, ['比赛（当前分组：甲组）'])
  } finally {
    raceController.autoConnect = originalAutoConnect
    captured.onUnload()
  }
})
