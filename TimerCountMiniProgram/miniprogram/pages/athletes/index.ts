import type { AthleteProfile } from '../../domain/athlete-profile'
import { formatRelativeTotalTime } from '../../domain/relative-total-time'
import { athleteCatalog, groupStore, raceController } from '../../services/app-services'

let unsubscribeCatalog: (() => void) | null = null
let unsubscribeRace: (() => void) | null = null
let unsubscribeScores: (() => void) | null = null
let unsubscribeGroups: (() => void) | null = null

Page({
  data: {
    athletes: [] as Array<{ id: number; name: string; epc: string; lap: string; totalTime: string }>,
    archivedAthletes: [] as Array<{ id: number; name: string; epc: string }>,
    showArchived: false,
    editingId: 0,
    formName: '',
    formEpc: '',
    busy: false,
    managementEnabled: true,
    groups: [] as Array<{ id: string; name: string; count: number }>,
    groupModalVisible: false,
    editingGroupId: '',
    groupFormName: '',
    groupSearch: '',
    groupSelectedIds: [] as number[],
    groupCandidates: [] as Array<{ id: number; name: string; epc: string; selected: boolean }>,
  },

  onLoad() {
    unsubscribeCatalog = athleteCatalog.subscribe(() => this.renderAthletes())
    unsubscribeScores = raceController.subscribeAthletes(() => this.renderAthletes())
    unsubscribeRace = raceController.subscribe(() => {
      this.setData({ managementEnabled: raceController.canManageAthletes })
      this.renderAthletes()
    })
    unsubscribeGroups = groupStore.subscribe((groups) => {
      this.setData({ groups: groups.map(({ id, name, athleteIds }) => ({ id, name, count: athleteIds.length })) })
    })
  },

  onUnload() {
    unsubscribeCatalog?.()
    unsubscribeRace?.()
    unsubscribeScores?.()
    unsubscribeGroups?.()
    unsubscribeCatalog = null
    unsubscribeRace = null
    unsubscribeScores = null
    unsubscribeGroups = null
  },

  renderAthletes() {
    const scores = raceController.athletesSnapshot
    const scoreById = new Map(scores.map((athlete) => [athlete.id, athlete]))
    const leader = scores.find(({ id }) => id === raceController.snapshot.leaderAthleteId)
    this.setData({
      athletes: athleteCatalog.activeSnapshot.map((profile) => {
        const score = scoreById.get(profile.id)
        return {
          id: profile.id,
          name: profile.name,
          epc: profile.epc,
          lap: !score || score.lapCount < 0 ? '—' : String(score.lapCount),
          totalTime: score ? formatRelativeTotalTime(score, leader) : '—',
        }
      }),
      archivedAthletes: athleteCatalog.archivedSnapshot.map(({ id, name, epc }) => ({ id, name, epc })),
    })
  },

  updateName(event: WechatMiniprogram.Input) {
    this.setData({ formName: event.detail.value })
  },

  updateEpc(event: WechatMiniprogram.Input) {
    this.setData({ formEpc: event.detail.value.toUpperCase() })
  },

  async saveAthlete() {
    if (!this.ensureManagementEnabled()) return
    const editingId = this.data.editingId
    await this.runManagementAction(
      () => editingId
        ? athleteCatalog.update(editingId, this.data.formName, this.data.formEpc).then(() => undefined)
        : athleteCatalog.create(this.data.formName, this.data.formEpc).then(() => undefined),
      editingId ? '运动员信息已更新' : '运动员已添加',
      true,
    )
  },

  editAthlete(event: WechatMiniprogram.TouchEvent) {
    if (!this.ensureManagementEnabled()) return
    const athlete = this.findProfile(Number(event.currentTarget.dataset.id))
    if (!athlete) return
    this.setData({ editingId: athlete.id, formName: athlete.name, formEpc: athlete.epc })
  },

  cancelEdit() {
    this.setData({ editingId: 0, formName: '', formEpc: '' })
  },

  archiveAthlete(event: WechatMiniprogram.TouchEvent) {
    if (!this.ensureManagementEnabled()) return
    const id = Number(event.currentTarget.dataset.id)
    const athlete = this.findProfile(id)
    if (!athlete) return
    wx.showModal({
      title: '归档运动员',
      content: `确认归档 ${athlete.name}？归档后将从所有分组移除。`,
      success: async (result) => {
        if (result.confirm) {
          await this.runManagementAction(() => athleteCatalog.archive(id), '运动员已归档')
        }
      },
    })
  },

  async restoreAthlete(event: WechatMiniprogram.TouchEvent) {
    if (!this.ensureManagementEnabled()) return
    const id = Number(event.currentTarget.dataset.id)
    await this.runManagementAction(() => athleteCatalog.restore(id).then(() => undefined), '运动员已恢复')
  },

  toggleArchived() {
    this.setData({ showArchived: !this.data.showArchived })
  },

  manageGroups() {
    if (!this.ensureManagementEnabled()) return
    const groups = groupStore.snapshot
    wx.showActionSheet({
      itemList: ['新建分组', ...groups.map(({ name }) => `编辑：${name}`)],
      success: (result) => {
        if (result.tapIndex === 0) this.openGroupEditor(null)
        else this.openGroupEditor(groups[result.tapIndex - 1]!.id)
      },
    })
  },

  openGroupEditor(groupId: string | null) {
    const group = groupId ? groupStore.snapshot.find(({ id }) => id === groupId) : null
    this.setData({
      groupModalVisible: true,
      editingGroupId: group?.id ?? '',
      groupFormName: group?.name ?? '',
      groupSearch: '',
      groupSelectedIds: [...(group?.athleteIds ?? [])],
      groupCandidates: this.buildGroupCandidates(group?.athleteIds ?? []),
    })
  },

  closeGroupEditor() { this.setData({ groupModalVisible: false }) },
  updateGroupName(event: WechatMiniprogram.Input) { this.setData({ groupFormName: event.detail.value }) },
  updateGroupSearch(event: WechatMiniprogram.Input) {
    const search = event.detail.value.trim().toLowerCase()
    this.setData({
      groupSearch: event.detail.value,
      groupCandidates: this.buildGroupCandidates(this.data.groupSelectedIds, search),
    })
  },

  toggleGroupMember(event: WechatMiniprogram.TouchEvent) {
    const id = Number(event.currentTarget.dataset.id)
    const selected = new Set(this.data.groupSelectedIds)
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    const groupSelectedIds = [...selected]
    this.setData({
      groupSelectedIds,
      groupCandidates: this.buildGroupCandidates(groupSelectedIds, this.data.groupSearch.trim().toLowerCase()),
    })
  },

  saveGroup() {
    if (!this.ensureManagementEnabled()) return
    try {
      const ids = this.data.groupSelectedIds
      if (this.data.editingGroupId) groupStore.update(this.data.editingGroupId, this.data.groupFormName, ids)
      else groupStore.create(this.data.groupFormName, ids)
      this.setData({ groupModalVisible: false })
    } catch (error) {
      this.showError(error, '保存分组失败')
    }
  },

  deleteGroup() {
    if (!this.ensureManagementEnabled() || !this.data.editingGroupId) return
    wx.showModal({
      title: '删除分组',
      content: '确认删除当前分组？',
      success: (result) => {
        if (result.confirm) {
          groupStore.remove(this.data.editingGroupId)
          this.setData({ groupModalVisible: false })
        }
      },
    })
  },

  buildGroupCandidates(selectedIds: number[], search = '') {
    const selected = new Set(selectedIds)
    return athleteCatalog.activeSnapshot
      .filter(({ id, name, epc }) => !search || `${id} ${name} ${epc}`.toLowerCase().includes(search))
      .map(({ id, name, epc }) => ({ id, name, epc, selected: selected.has(id) }))
  },

  findProfile(id: number): AthleteProfile | undefined {
    return [...athleteCatalog.activeSnapshot, ...athleteCatalog.archivedSnapshot]
      .find((athlete) => athlete.id === id)
  },

  ensureManagementEnabled(): boolean {
    if (raceController.canManageAthletes) return true
    wx.showToast({ title: '本场比赛重置前不能修改运动员名单', icon: 'none' })
    return false
  },

  async runManagementAction(
    action: () => Promise<void>,
    successMessage: string,
    clearForm = false,
  ) {
    if (this.data.busy) return
    this.setData({ busy: true })
    try {
      await action()
      if (clearForm) this.setData({ editingId: 0, formName: '', formEpc: '' })
      wx.showToast({ title: successMessage, icon: 'none' })
    } catch (error) {
      this.showError(error, '操作失败')
    } finally {
      this.setData({ busy: false })
    }
  },

  showError(error: unknown, fallback: string) {
    wx.showToast({ title: error instanceof Error ? error.message : fallback, icon: 'none' })
  },
})
