export interface CatalogRefreshResult {
  state: 'completed' | 'failed'
  message?: string
}

export interface CatalogRefresher {
  refresh(): Promise<CatalogRefreshResult>
}

export interface StartupStatus {
  state: 'completed' | 'partial'
  catalog: CatalogRefreshResult
  racesWoken: boolean
}

interface Options {
  catalogRefresher: CatalogRefresher
  wakePendingRaces(): Promise<void> | void
}

/**
 * 启动阶段只协调本地目录刷新与待处理比赛唤醒。
 * 不下载线上比赛历史，也不上传本地目录或比赛数据。
 */
export class StartupSync {
  private running: Promise<StartupStatus> | null = null

  constructor(private readonly options: Options) {}

  runOnce(): Promise<StartupStatus> {
    if (!this.running) this.running = this.execute()
    return this.running
  }

  private async execute(): Promise<StartupStatus> {
    const catalog = this.options.catalogRefresher.refresh().catch((error: unknown): CatalogRefreshResult => ({
      state: 'failed', message: error instanceof Error ? error.message : '目录刷新失败',
    }))
    const wake = Promise.resolve().then(() => this.options.wakePendingRaces())
      .then(() => true, () => false)
    const [catalogResult, racesWoken] = await Promise.all([catalog, wake])
    return { state: catalogResult.state === 'completed' && racesWoken ? 'completed' : 'partial', catalog: catalogResult, racesWoken }
  }
}