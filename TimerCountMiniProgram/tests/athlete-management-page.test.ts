import assert from 'node:assert/strict'
import test from 'node:test'

import { createAthletePageDefinition } from '../miniprogram/pages/athletes/page-controller'

type Result = { ok: boolean; message: string }
type AthletePageDependencies = Parameters<typeof createAthletePageDefinition>[0]

class PageHarness {
  data: Record<string, unknown>
  constructor(initial: Record<string, unknown>) { this.data = structuredClone(initial) }
  setData(patch: Record<string, unknown>): void { Object.assign(this.data, patch) }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function fixture(overrides: Partial<AthletePageDependencies> = {}) {
  const toasts: string[] = []
  const dependenciesValue = { ...dependencies(), ...overrides }
  const definition = createAthletePageDefinition(dependenciesValue, (title) => toasts.push(title))
  const page = new PageHarness(definition.data as unknown as Record<string, unknown>)
  return { definition, page, toasts, dependencies: dependenciesValue }
}

function dependencies() {
  const active = [{ id: 1, name: '甲', epc: '01020304' }]
  return {
    athleteCatalog: {
      activeSnapshot: active,
      archivedSnapshot: [],
      subscribe: (listener: () => void) => { listener(); return () => undefined },
    },
    groupStore: {
      snapshot: [{ id: '1', name: '第一组', athleteIds: [1] }],
      subscribe: (listener: (groups: Array<{ id: string; name: string; athleteIds: number[] }>) => void) => {
        listener([{ id: '1', name: '第一组', athleteIds: [1] }]); return () => undefined
      },
    },
    raceController: {
      canManageAthletes: true,
      athletesSnapshot: [],
      snapshot: { leaderAthleteId: null },
      subscribe: (listener: () => void) => { listener(); return () => undefined },
      subscribeAthletes: (listener: () => void) => { listener(); return () => undefined },
      selectGroup: (_groupId: string | null): void => undefined,
    },
    athleteManagement: {
      create: async (): Promise<Result> => ({ ok: true, message: '已保存' }),
      update: async (): Promise<Result> => ({ ok: true, message: '已保存' }),
      archive: async (): Promise<Result> => ({ ok: true, message: '已保存' }),
      restore: async (): Promise<Result> => ({ ok: true, message: '已保存' }),
    },
    groupManagement: {
      create: async (): Promise<Result> => ({ ok: true, message: '已保存' }),
      update: async (): Promise<Result> => ({ ok: true, message: '已保存' }),
      delete: async (): Promise<Result> => ({ ok: true, message: '已保存' }),
    },
    catalogSync: { refresh: async (): Promise<{ state: 'completed' | 'failed'; message?: string }> => ({ state: 'completed' }) },
  }
}

test('athlete page waits for server receipt before success toast', async () => {
  const pending = deferred<Result>()
  let calls = 0
  const { definition, page, toasts } = fixture({
    athleteManagement: { ...dependencies().athleteManagement, create: () => { calls += 1; return pending.promise } },
  })
  page.setData({ formName: '乙', formEpc: '11223344', backendAvailable: true })
  const saving = definition.saveAthlete.call(page as never)

  assert.equal(calls, 1)
  assert.equal(page.data.busy, true)
  assert.deepEqual(toasts, [])
  pending.resolve({ ok: true, message: '已保存' })
  await saving
  assert.deepEqual(toasts, ['运动员已添加'])
  assert.equal(page.data.formName, '')
})

test('failed group save keeps editor open and cache unchanged', async () => {
  const groups = dependencies().groupStore.snapshot
  const { definition, page, toasts } = fixture({
    groupManagement: { ...dependencies().groupManagement, create: async () => ({ ok: false, message: '网络错误' }) },
  })
  page.setData({ groupModalVisible: true, editingGroupId: '', groupFormName: '第二组', groupSelectedIds: [1], backendAvailable: true })
  await definition.saveGroup.call(page as never)

  assert.equal(page.data.groupModalVisible, true)
  assert.equal(page.data.groupFormName, '第二组')
  assert.deepEqual(groups, [{ id: '1', name: '第一组', athleteIds: [1] }])
  assert.deepEqual(toasts, ['暂时无法保存分组，请稍后重试'])
})

test('offline roster management is disabled but cached selection remains available', async () => {
  const { definition, page } = fixture({ catalogSync: { refresh: async () => ({ state: 'failed' as const }) } })
  definition.onLoad.call(page as never)
  await Promise.resolve()
  await Promise.resolve()

  assert.equal(page.data.backendAvailable, false)
  assert.equal(page.data.backendMessage, '目录同步超时或失败，仍可查看已缓存的名单和分组。')
  assert.deepEqual((page.data.groups as Array<{ name: string }>).map((group) => group.name), ['第一组'])
  assert.deepEqual((page.data.athletes as Array<{ name: string }>).map((athlete) => athlete.name), ['甲'])
})

test('athlete page selects a cached group for the current race', async () => {
  const selectedGroupIds: Array<string | null> = []
  const { definition, page } = fixture({
    raceController: {
      ...dependencies().raceController,
      selectGroup: (groupId: string | null) => selectedGroupIds.push(groupId),
    },
    chooseGroupEditor: async () => 1,
  })

  await definition.selectRaceGroup.call(page as never)

  assert.deepEqual(selectedGroupIds, ['1'])
})

test('athlete editor saves modal values without changing the new-athlete form', async () => {
  const updates: Array<[number, string, string]> = []
  const { definition, page } = fixture({
    athleteManagement: {
      ...dependencies().athleteManagement,
      update: async (id, name, epc) => {
        updates.push([id, name, epc])
        return { ok: true, message: '已保存' }
      },
    },
  })
  page.setData({ backendAvailable: true, formName: '待新增', formEpc: 'AABBCCDD' })

  definition.editAthlete.call(page as never, { currentTarget: { dataset: { id: 1 } } } as never)
  assert.equal(page.data.athleteEditorVisible, true)
  assert.equal(page.data.editFormName, '甲')
  assert.equal(page.data.editFormEpc, '01020304')

  page.setData({ editFormName: '乙', editFormEpc: '11223344' })
  await definition.saveEditedAthlete.call(page as never)

  assert.deepEqual(updates, [[1, '乙', '11223344']])
  assert.equal(page.data.athleteEditorVisible, false)
  assert.equal(page.data.formName, '待新增')
  assert.equal(page.data.formEpc, 'AABBCCDD')
})

test('athlete search filters the list with a regular expression', () => {
  const { definition, page } = fixture({
    athleteCatalog: {
      ...dependencies().athleteCatalog,
      activeSnapshot: [
        { id: 1, name: '甲', epc: '01020304' },
        { id: 2, name: '乙', epc: '11223344' },
      ],
    },
  })
  definition.onLoad.call(page as never)

  definition.updateAthleteSearch.call(page as never, { detail: { value: '^(甲|乙)$' } } as never)

  assert.deepEqual((page.data.athletes as Array<{ name: string }>).map(({ name }) => name), ['甲', '乙'])
})
