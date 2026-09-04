import { BACKEND_CONFIG } from './config'

export interface TransportRequest {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  header: Record<string, string>
  data?: object
  timeout: number
}

export type BackendTransport = (request: TransportRequest) => Promise<{ statusCode: number; data: unknown }>
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
  constructor(private readonly transport: BackendTransport = wechatRequest) {}

  async request<T>(options: RequestOptions): Promise<ApiResult<T>> {
    try {
      const query = Object.entries(options.query ?? {})
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join('&')
      const response = await this.transport({
        url: `${BACKEND_CONFIG.baseUrl}${options.path}${query ? `?${query}` : ''}`,
        method: options.method,
        header: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(options.data === undefined ? {} : { data: options.data }),
        timeout: BACKEND_CONFIG.timeoutMs,
      })
      return parseResponse<T>(response.statusCode, response.data)
    } catch {
      // 返回状态供上层决定提示策略；不自动重试、弹窗、写本地或记录响应正文。
      return { ok: false, kind: 'network', message: '网络请求失败或超时' }
    }
  }
}

function wechatRequest(request: TransportRequest): ReturnType<BackendTransport> {
  return new Promise((resolve, reject) => {
    wx.request({
      ...request,
      success: (response) => resolve({ statusCode: response.statusCode, data: response.data }),
      fail: () => reject(new Error('backend-network')),
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
