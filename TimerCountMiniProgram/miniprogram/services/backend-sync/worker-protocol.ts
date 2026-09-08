import type { RaceBundleDto, RaceInfoDto, ScoreDto } from '../backend-api/types'
import type { ApiResult } from '../backend-api/request'

export type WorkerEndpoint = 'create-race' | 'create-score' | 'save-race-bundle'
/** Worker 仅传输受限业务载荷，不接触 wx、存储、页面或 BLE。 */
export interface WorkerRequest {
  type: 'request'
  requestId: string
  taskId: string
  endpoint: WorkerEndpoint
  payload: RaceInfoDto | ScoreDto | RaceBundleDto
}
export interface WorkerResult { type: 'result'; requestId: string; taskId: string; result: ApiResult<unknown> }
