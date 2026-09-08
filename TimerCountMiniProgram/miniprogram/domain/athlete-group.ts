export interface AthleteGroup {
  id: string
  name: string
  athleteIds: number[]
  createdAt: number
  updatedAt: number
  /** 服务端软删除状态；旧本地记录缺失时按启用处理。 */
  enabled?: boolean
  /** 仅缓存服务端成员软删除状态，页面仍按 athleteIds 显示完整原始成员。 */
  memberEnabled?: Record<string, boolean>
}
