import type { AthleteProfile } from '../../domain/athlete-profile'
import { formatRelativeTotalTime } from '../../domain/relative-total-time'

export interface ManagementResult { ok: boolean; message: string }

interface AthletePageDependencies {
  athleteCatalog: {
    activeSnapshot: readonly Pick<AthleteProfile, 'id' | 'name' | 'epc'>[]
    archivedSnapshot: readonly Pick<AthleteProfile, 'id' | 'name' | 'epc'>[]
    subscribe(listener: () => void): () => void
  }
  groupStore: {
    snapshot: readonly { id: string; name: string; athleteIds: readonly number[] }[]
    subscribe(listener: (groups: readonly { id: string; name: string; athleteIds: readonly number[] }[]) => void): () => void
  }
  raceController: {
    canManageAthletes: boolean
    athletesSnapshot: readonly { id: number; lapCount: number; totalCentiseconds: number }[]
    snapshot: { leaderAthleteId: number | null }
    subscribe(listener: () => void): () => void
    subscribeAthletes(listener: () => void): () => void
  }
  athleteManagement: {
    create(name: string, epc: string): Promise<ManagementResult>
    update(id: number, name: string, epc: string): Promise<ManagementResult>
    archive(id: number): Promise<ManagementResult>
    restore(id: number): Promise<ManagementResult>
  }
  groupManagement: {
    create(name: string, athleteIds: number[]): Promise<ManagementResult>
    update(id: string, name: string, athleteIds: number[]): Promise<ManagementResult>
    delete(id: string): Promise<ManagementResult>
  }
  catalogSync: { refresh(): Promise<{ state: 'completed' | 'failed'; message?: string }> }
  confirm?: (title: string, content: string) => Promise<boolean>
  chooseGroupEditor?: (items: string[]) => Promise<number | null>
}

interface AthletePageData {
  athletes: Array<{ id: number; name: string; epc: string; lap: string; totalTime: string }>
  archivedAthletes: Array<{ id: number; name: string; epc: string }>
  showArchived: boolean
  editingId: number
  formName: string
  formEpc: string
  busy: boolean
  managementEnabled: boolean
  backendAvailable: boolean
  backendMessage: string
  groups: Array<{ id: string; name: string; count: number }>
  groupModalVisible: boolean
  editingGroupId: string
  groupFormName: string
  groupSearch: string
  groupSelectedIds: number[]
  groupCandidates: Array<{ id: number; name: string; epc: string; selected: boolean }>
}

interface PageContext {
  data: AthletePageData
  setData(patch: Partial<AthletePageData>): void
}

export function createAthletePageDefinition(
  dependencies: AthletePageDependencies,
  notify: (title: string) => void = (title) => wx.showToast({ title, icon: 'none' }),
) {
  let unsubscribeCatalog: (() => void) | null = null
  let unsubscribeRace: (() => void) | null = null
  let unsubscribeScores: (() => void) | null = null
  let unsubscribeGroups: (() => void) | null = null

  const renderAthletes = (page: PageContext) => {
    const scores = dependencies.raceController.athletesSnapshot
    const scoreById = new Map(scores.map((athlete) => [athlete.id, athlete]))
    const leader = scores.find(({ id }) => id === dependencies.raceController.snapshot.leaderAthleteId)
    page.setData({
      athletes: dependencies.athleteCatalog.activeSnapshot.map((profile) => {
        const score = scoreById.get(profile.id)
        return {
          id: profile.id,
          name: profile.name,
          epc: profile.epc,
          lap: !score || score.lapCount < 0 ? '—' : String(score.lapCount),
          totalTime: score ? formatRelativeTotalTime(score as never, leader as never) : '—',
        }
      }),
      archivedAthletes: dependencies.athleteCatalog.archivedSnapshot.map(({ id, name, epc }) => ({ id, name, epc })),
    })
  }

  const refreshAvailability = async (page: PageContext) => {
    const status = await dependencies.catalogSync.refresh()
    page.setData({
      backendAvailable: status.state === 'completed',
      backendMessage: status.state === 'completed' ? '' : '服务器暂不可用，仍可查看已缓存的名单和分组。',
    })
  }

  const ensureManagementEnabled = (page: PageContext): boolean => {
    if (!dependencies.raceController.canManageAthletes) {
      notify('本场比赛重置前不能修改运动员名单')
      return false
    }
    if (!page.data.backendAvailable) {
      notify('服务器暂不可用，请稍后重试')
      return false
    }
    return true
  }

  const buildGroupCandidates = (selectedIds: number[], search = '') => {
    const selected = new Set(selectedIds)
    return dependencies.athleteCatalog.activeSnapshot
      .filter(({ id, name, epc }) => !search || `${id} ${name} ${epc}`.toLowerCase().includes(search))
      .map(({ id, name, epc }) => ({ id, name, epc, selected: selected.has(id) }))
  }

  const openGroupEditor = (page: PageContext, groupId: string | null) => {
    const group = groupId ? dependencies.groupStore.snapshot.find(({ id }) => id === groupId) : null
    page.setData({
      groupModalVisible: true,
      editingGroupId: group?.id ?? '',
      groupFormName: group?.name ?? '',
      groupSearch: '',
      groupSelectedIds: [...(group?.athleteIds ?? [])],
      groupCandidates: buildGroupCandidates([...(group?.athleteIds ?? [])]),
    })
  }

  const runManagementAction = async (
    page: PageContext,
    action: () => Promise<ManagementResult>,
    successMessage: string,
    onSuccess?: () => void,
    failureMessage = '暂时无法保存，请稍后重试',
  ): Promise<boolean> => {
    if (page.data.busy || !ensureManagementEnabled(page)) return false
    page.setData({ busy: true })
    try {
      const result = await action()
      if (!result.ok) {
        notify(friendlyMessage(result.message, failureMessage))
        return false
      }
      onSuccess?.()
      notify(successMessage)
      return true
    } catch {
      notify(failureMessage)
      return false
    } finally {
      page.setData({ busy: false })
    }
  }

  return {
    data: {
      athletes: [], archivedAthletes: [], showArchived: false, editingId: 0, formName: '', formEpc: '', busy: false,
      managementEnabled: true, backendAvailable: false, backendMessage: '', groups: [], groupModalVisible: false,
      editingGroupId: '', groupFormName: '', groupSearch: '', groupSelectedIds: [], groupCandidates: [],
    } as AthletePageData,

    onLoad(this: PageContext) {
      unsubscribeCatalog = dependencies.athleteCatalog.subscribe(() => renderAthletes(this))
      unsubscribeScores = dependencies.raceController.subscribeAthletes(() => renderAthletes(this))
      unsubscribeRace = dependencies.raceController.subscribe(() => {
        this.setData({ managementEnabled: dependencies.raceController.canManageAthletes })
        renderAthletes(this)
      })
      unsubscribeGroups = dependencies.groupStore.subscribe((groups) => {
        this.setData({ groups: groups.map(({ id, name, athleteIds }) => ({ id, name, count: athleteIds.length })) })
      })
      void refreshAvailability(this)
    },

    onShow(this: PageContext) { void refreshAvailability(this) },

    onUnload() {
      unsubscribeCatalog?.(); unsubscribeRace?.(); unsubscribeScores?.(); unsubscribeGroups?.()
      unsubscribeCatalog = null; unsubscribeRace = null; unsubscribeScores = null; unsubscribeGroups = null
    },

    updateName(this: PageContext, event: WechatMiniprogram.Input) { this.setData({ formName: event.detail.value }) },
    updateEpc(this: PageContext, event: WechatMiniprogram.Input) { this.setData({ formEpc: event.detail.value.toUpperCase() }) },

    async saveAthlete(this: PageContext) {
      const editingId = this.data.editingId
      await runManagementAction(
        this,
        () => editingId
          ? dependencies.athleteManagement.update(editingId, this.data.formName, this.data.formEpc)
          : dependencies.athleteManagement.create(this.data.formName, this.data.formEpc),
        editingId ? '运动员信息已更新' : '运动员已添加',
        () => this.setData({ editingId: 0, formName: '', formEpc: '' }),
      )
    },

    editAthlete(this: PageContext, event: WechatMiniprogram.TouchEvent) {
      if (!ensureManagementEnabled(this) || this.data.busy) return
      const athlete = findProfile(dependencies, Number(event.currentTarget.dataset.id))
      if (athlete) this.setData({ editingId: athlete.id, formName: athlete.name, formEpc: athlete.epc })
    },
    cancelEdit(this: PageContext) { this.setData({ editingId: 0, formName: '', formEpc: '' }) },

    async archiveAthlete(this: PageContext, event: WechatMiniprogram.TouchEvent) {
      if (!ensureManagementEnabled(this) || this.data.busy) return
      const id = Number(event.currentTarget.dataset.id)
      const athlete = findProfile(dependencies, id)
      if (!athlete || !await confirm(dependencies, '归档运动员', `确认归档 ${athlete.name}？归档后将从所有分组移除。`)) return
      await runManagementAction(this, () => dependencies.athleteManagement.archive(id), '运动员已归档')
    },

    async restoreAthlete(this: PageContext, event: WechatMiniprogram.TouchEvent) {
      if (!ensureManagementEnabled(this) || this.data.busy) return
      const id = Number(event.currentTarget.dataset.id)
      await runManagementAction(this, () => dependencies.athleteManagement.restore(id), '运动员已恢复')
    },

    toggleArchived(this: PageContext) { this.setData({ showArchived: !this.data.showArchived }) },

    async manageGroups(this: PageContext) {
      if (!ensureManagementEnabled(this) || this.data.busy) return
      const groups = dependencies.groupStore.snapshot
      const index = await choose(dependencies, ['新建分组', ...groups.map(({ name }) => `编辑：${name}`)])
      if (index === null) return
      openGroupEditor(this, index === 0 ? null : groups[index - 1]?.id ?? null)
    },

    openGroupEditor(this: PageContext, groupId: string | null) { openGroupEditor(this, groupId) },
    closeGroupEditor(this: PageContext) { this.setData({ groupModalVisible: false }) },
    updateGroupName(this: PageContext, event: WechatMiniprogram.Input) { this.setData({ groupFormName: event.detail.value }) },
    updateGroupSearch(this: PageContext, event: WechatMiniprogram.Input) {
      const search = event.detail.value.trim().toLowerCase()
      this.setData({ groupSearch: event.detail.value, groupCandidates: buildGroupCandidates(this.data.groupSelectedIds, search) })
    },
    toggleGroupMember(this: PageContext, event: WechatMiniprogram.TouchEvent) {
      if (!ensureManagementEnabled(this) || this.data.busy) return
      const selected = new Set(this.data.groupSelectedIds)
      const id = Number(event.currentTarget.dataset.id)
      if (selected.has(id)) selected.delete(id); else selected.add(id)
      const groupSelectedIds = [...selected]
      this.setData({ groupSelectedIds, groupCandidates: buildGroupCandidates(groupSelectedIds, this.data.groupSearch.trim().toLowerCase()) })
    },

    async saveGroup(this: PageContext) {
      const editingGroupId = this.data.editingGroupId
      await runManagementAction(
        this,
        () => editingGroupId
          ? dependencies.groupManagement.update(editingGroupId, this.data.groupFormName, this.data.groupSelectedIds)
          : dependencies.groupManagement.create(this.data.groupFormName, this.data.groupSelectedIds),
        editingGroupId ? '分组已更新' : '分组已创建',
        () => this.setData({ groupModalVisible: false }),
        '暂时无法保存分组，请稍后重试',
      )
    },

    async deleteGroup(this: PageContext) {
      const id = this.data.editingGroupId
      if (!id || !ensureManagementEnabled(this) || this.data.busy
          || !await confirm(dependencies, '删除分组', '确认删除当前分组？')) return
      await runManagementAction(this, () => dependencies.groupManagement.delete(id), '分组已删除',
        () => this.setData({ groupModalVisible: false }), '暂时无法删除分组，请稍后重试')
    },
  }
}

function findProfile(dependencies: AthletePageDependencies, id: number): Pick<AthleteProfile, 'id' | 'name' | 'epc'> | undefined {
  return [...dependencies.athleteCatalog.activeSnapshot, ...dependencies.athleteCatalog.archivedSnapshot]
    .find((athlete) => athlete.id === id)
}

function friendlyMessage(message: string, fallback: string): string {
  return /不能为空|不能超过|EPC|不存在|已绑定|已归档|成员/.test(message) ? message : fallback
}

function confirm(dependencies: AthletePageDependencies, title: string, content: string): Promise<boolean> {
  if (dependencies.confirm) return dependencies.confirm(title, content)
  return new Promise((resolve) => wx.showModal({ title, content, success: (result) => resolve(result.confirm) }))
}

function choose(dependencies: AthletePageDependencies, items: string[]): Promise<number | null> {
  if (dependencies.chooseGroupEditor) return dependencies.chooseGroupEditor(items)
  return new Promise((resolve) => wx.showActionSheet({ itemList: items, success: (result) => resolve(result.tapIndex), fail: () => resolve(null) }))
}
