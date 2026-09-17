import { BACKEND_CONFIG } from './config'

export interface TransportRequest {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  header: Record<string, string>
  data?: object
  timeout: number
}

export type BackendTransport = (request: TransportRequest) => Promise<{ statusCode: number; data: unknown }>
export interface BackendDiagnosticLogger {
  info(message: string, details: Record<string, unknown>): void
  warn(message: string, details: Record<string, unknown>): void
}
export interface RequestOptions {
  path: string
  method: TransportRequest['method']
  data?: object
  query?: Record<string, string | number | boolean>
}
export type ApiResult<T> = { ok: true; httpStatus: number; data: T } | {
  ok: false
  kind: 'http' | 'business' | 'network' | 'invalid-response'
  httpStatus?: number
  code?: number
  message: string
  errorMsg?: string
}

export class BackendClient {
  constructor(
    private readonly transport: BackendTransport = cloudContainerRequest,
    private readonly logger: BackendDiagnosticLogger = consoleDiagnosticLogger,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async request<T>(options: RequestOptions): Promise<ApiResult<T>> {
    const startedAt = this.now()
    try {
      const query = Object.entries(options.query ?? {})
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
      const path = `${options.path}${query ? `?${query}` : ''}`
      this.logger.info('[Backend] 请求发起', requestDetails(this.now(), options.method, path, { timeoutMs: BACKEND_CONFIG.timeoutMs }))
      const containerPath = `${BACKEND_CONFIG.apiBasePath}${path.startsWith('/') ? path : `/${path}`}`
      const response = await this.transport({
        path: containerPath,
        method: options.method,
        header: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(options.data === undefined ? {} : { data: options.data }),
        timeout: BACKEND_CONFIG.timeoutMs,
      })
      const result = parseResponse<T>(response.statusCode, response.data)
      const details = requestDetails(this.now(), options.method, path, { elapsedMs: this.now() - startedAt })
      if (result.ok) this.logger.info('[Backend] 请求成功', { ...details, httpStatus: response.statusCode })
      else this.logger.warn('[Backend] 请求失败', { ...details, httpStatus: response.statusCode, kind: result.kind, message: result.message })
      return result
    } catch {
      // 返回状态供上层决定提示策略；不自动重试、弹窗、写本地或记录响应正文。
      const result: ApiResult<never> = { ok: false, kind: 'network', message: '网络请求失败或超时' }
      this.logger.warn('[Backend] 请求失败', requestDetails(this.now(), options.method, options.path, {
        elapsedMs: this.now() - startedAt, kind: result.kind, message: result.message,
      }))
      return result
    }
  }
}

const consoleDiagnosticLogger: BackendDiagnosticLogger = {
  info: (message, details) => console.info(message, details),
  warn: (message, details) => console.warn(message, details),
}

function requestDetails(timestamp: number, method: TransportRequest['method'], path: string, details: Record<string, unknown>): Record<string, unknown> {
  return { timestamp: new Date(timestamp).toISOString(), method, path, ...details }
}

function cloudContainerRequest(request: TransportRequest): ReturnType<BackendTransport> {
  return new Promise((resolve, reject) => {
    wx.cloud.callContainer({
      config: { env: BACKEND_CONFIG.cloudEnvId },
      service: BACKEND_CONFIG.cloudService,
      path: request.path,
      method: request.method,
      header: request.header,
      ...(request.data === undefined ? {} : { data: request.data }),
      timeout: request.timeout,
      success: (response) => resolve({ statusCode: response.statusCode, data: response.data }),
      fail: () => reject(new Error('cloud-container-network')),
    })
  })
}

function parseResponse<T>(httpStatus: number, body: unknown): ApiResult<T> {
  const envelope = body !== null && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown> : null
  const details = {
    ...(typeof envelope?.code === 'number' ? { code: envelope.code } : {}),
    ...(typeof envelope?.errorMsg === 'string' ? { errorMsg: envelope.errorMsg } : {}),
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { ok: false, kind: 'http', httpStatus, ...details, message: `HTTP ${httpStatus}` }
  }
  if (!envelope || typeof envelope.code !== 'number' || !Number.isInteger(envelope.code)) {
    return { ok: false, kind: 'invalid-response', httpStatus, message: '接口响应格式错误' }
  }
  if (envelope.code !== 0) {
    return { ok: false, kind: 'business', httpStatus, ...details,
      message: typeof envelope.message === 'string' ? envelope.message : '接口业务失败' }
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
    return { ok: false, kind: 'invalid-response', httpStatus, message: '接口响应缺少 data' }
  }
  // 此层只验证响应信封，业务数据校验由对应接口/同步模块负责。
  return { ok: true, httpStatus, data: envelope.data as T }
}

export const backendClient = new BackendClient()
