# 微信云托管统一后端访问设计

## 目标

将小程序的后端访问由完整 URL 的 `wx.request` 改为微信云托管 `wx.cloud.callContainer`。所有业务接口、启动同步、比赛上传与保留的临时同步路径都只能通过 `miniprogram/services/backend-api/` 中的统一客户端访问后端。



## 固定配置

统一配置位于 `miniprogram/services/backend-api/config.ts`，仅保存以下非机密运行参数：

- 云托管环境 ID：`prod-d7ggbetdd4afc3563`；
- 云托管服务名：`springboot-z3m5`；
- 接口基础路径：`/api/v1`；
- 临时 ClubID 与请求超时。

小程序不再保存或拼接外部后端域名。原 `config/app-config.ts` 不承载后端配置，避免微信开发者工具将该独立文件错误裁剪后产生未定义模块。



## 请求边界

`BackendClient` 是小程序唯一的后端客户端：

```text
业务 API / 启动同步 / 比赛同步 / 临时同步
→ BackendClient.request({ path, method, data, query })
→ 云托管传输适配器
→ wx.cloud.callContainer({ config.env, service, path, method, header, data, timeout })
→ springboot-z3m5 服务
```

传输适配器只接收相对路径，不接受完整 URL。`BackendClient` 在内部编码查询参数、补上 `/api/v1` 前缀、记录不含请求正文的诊断日志，并保持当前响应信封判定：仅 HTTP 2xx 且 `code === 0` 为成功。

`app.ts` 在启动时调用 `wx.cloud.init()`，在启动同步之前完成云能力初始化。初始化异常不得阻断 BLE；后端请求会以现有网络失败状态返回。



## 兼容与错误处理

- HTTP 方法继续支持 `GET`、`POST`、`PUT`、`DELETE`。
- `callContainer` 的成功回调数据映射为既有 `{ statusCode, data }` 传输结果，业务 DTO 与响应校验保持不变。
- API 调用失败、云能力不可用或云托管调用失败均返回既有 `ApiResult` 的 `network` 状态；不自动重试、不记录请求正文或响应正文。
- 临时同步模块虽然默认停用，也必须删除其中直接的 `wx.request` 调用，改由 `BackendClient` 执行 POST，防止后续误启用时绕过统一入口。



## 非目标

- 不修改后端接口路径、DTO、返回信封、ClubID 或比赛同步规则。
- 不新增鉴权头、密钥或外部域名白名单配置。
- 不启用已停用的临时同步，也不向真实云托管执行写入测试。



## 验证

- 单元测试覆盖云托管调用的环境 ID、服务名、基础路径、HTTP 方法、查询参数、响应映射与失败映射。
- 静态搜索确认小程序源代码中没有 `wx.request` 或旧完整后端地址。
- 运行 `npm test` 与 `npm run typecheck`。
- 在微信开发者工具和真机验证 `wx.cloud.init`、云托管服务绑定、环境/服务路由及既有读取接口；不以真实写入作为自动化测试。
