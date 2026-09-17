# 微信云托管统一后端访问实施计划

> 对执行助手：必须逐任务执行。每一步使用复选框跟踪，并先写失败测试、再实现、再验证。

**目标：** 将小程序所有后端请求统一改为经微信云托管 prod-d7ggbetdd4afc3563 的 springboot-z3m5 服务访问。

**架构：** 保留 BackendClient 与既有 API/DTO 层。客户端在 backend-api 内将相对业务路径拼接为 /api/v1 路径，并由唯一的云托管传输适配器调用 wx.cloud.callContainer。应用启动先初始化云能力；已停用临时同步复用客户端而不再直接访问网络。

**技术：** TypeScript、微信小程序 wx.cloud.init、wx.cloud.callContainer、Node 内置测试、微信开发者工具。

**设计依据：** docs/superpowers/specs/2026-09-15-cloud-container-backend-design.md

## 全局约束

- 修改范围仅限 TimerCountMiniProgram。
- 云托管环境 ID 固定为 prod-d7ggbetdd4afc3563，服务名固定为 springboot-z3m5。
- 业务路径保留 /api/v1 前缀和既有 DTO、响应信封规则。
- 业务模块不得直接调用 wx.request 或 wx.cloud.callContainer。
- 不向真实云托管写入测试数据。
- 保留用户现有未提交改动，不重置或覆盖无关文件。

---

### Task 1：云托管配置与传输契约

**文件：**
- 修改：miniprogram/services/backend-api/config.ts
- 修改：miniprogram/services/backend-api/request.ts
- 测试：tests/backend-api.test.ts

**接口：**
- 输入：既有 RequestOptions（path、method、data、query）。
- 输出：BackendClient.request<T>() 的调用方式不变；传输层改为接收已解析的云托管相对路径。
- 输出：BACKEND_CONFIG 包含 cloudEnvId、cloudService、apiBasePath、clubId、timeoutMs。

- [x] **Step 1：写入失败测试，断言云托管调用参数**

~~~ts
test('backend request calls the configured cloud container service', async () => {
  const outgoing: ICloud.CallContainerParam[] = []
  runtime.wx = { cloud: { callContainer: (request) => {
    outgoing.push(request)
    request.success?.({ statusCode: 200, data: { code: 0, data: {} } })
  } } }
  await new BackendClient().request({ method: 'POST', path: '/athletes', data: {} })
  assert.equal(outgoing[0]?.config?.env, 'prod-d7ggbetdd4afc3563')
  assert.equal(outgoing[0]?.service, 'springboot-z3m5')
  assert.equal(outgoing[0]?.path, '/api/v1/athletes')
})
~~~

- [x] **Step 2：运行失败测试**

运行：npm run build:test && node --test build-test/tests/backend-api.test.js

预期：失败，原因是当前实现访问 wx.request 或传输请求仍要求完整 URL。

- [x] **Step 3：最小化实现云托管传输**

在 config.ts 替换完整 URL 为 cloudEnvId、cloudService、apiBasePath。在 request.ts 中：
- 将传输请求字段从 url 改为 path；
- 统一拼接查询参数与 apiBasePath；
- 用 wx.cloud.callContainer 适配为既有 { statusCode, data }；
- 保持当前诊断日志、HTTP/业务/网络失败映射与依赖注入测试能力。

- [x] **Step 4：运行后端接口测试**

运行：npm run build:test && node --test build-test/tests/backend-api.test.js

预期：通过，全部后端接口、查询参数、错误映射和云托管参数断言通过。

- [x] **Step 5：检查客户端唯一性**

运行：rg -n 'wx\.request|https?://' miniprogram/services/backend-api miniprogram/pages miniprogram/services

预期：运行时代码没有直接 wx.request 或完整后端 URL。

### Task 2：应用初始化与临时同步收敛

**文件：**
- 修改：miniprogram/app.ts
- 修改：miniprogram/services/temporary-backend-sync.ts
- 测试：tests/temporary-backend-sync.test.ts

**接口：**
- 输入：backendClient.request({ path, method: 'POST', data }) 返回的 ApiResult。
- 输出：app.ts 在启动同步前调用云能力初始化；临时同步不直接引用微信网络 API。
- 保持：TEMPORARY_BACKEND_SYNC_ENABLED === false，临时同步默认仍不运行。

- [x] **Step 1：写入失败测试，断言临时同步生产装配不含直接网络请求**

~~~ts
test('temporary sync delegates production requests to BackendClient', async () => {
  const source = readFileSync(
    resolve(__dirname, '../miniprogram/services/temporary-backend-sync.ts'), 'utf8',
  )
  assert.doesNotMatch(source, /wx\.request/)
  assert.match(source, /backendClient\.request/)
})
~~~

- [x] **Step 2：运行失败测试**

运行：npm run build:test && node --test build-test/tests/temporary-backend-sync.test.js

预期：失败，当前临时同步仍包含 wx.request。

- [x] **Step 3：最小化替换临时同步的生产请求装配**

在 temporary-backend-sync.ts 中删除 baseUrl 和 wx.request Promise 包装，改为调用 backendClient.request。将 ApiResult 直接映射为临时同步既有的成功、失败计数，测试注入接口保持可用。

- [x] **Step 4：在 app.ts 初始化云能力**

在 onLaunch 的启动同步前调用 wx.cloud.init()。捕获初始化异常并输出不含凭证的诊断摘要；异常不阻断 BLE 或启动同步，后端调用仍沿既有网络失败路径处理。

- [x] **Step 5：运行临时同步与应用装配测试**

运行：npm run build:test && node --test build-test/tests/temporary-backend-sync.test.js build-test/tests/app-services.test.js

预期：通过，默认临时同步继续禁用，生产装配不含直接网络访问。

### Task 3：文档与全量验证

**文件：**
- 修改：README.md
- 修改：docs/HANDOFF.md
- 测试：tests/backend-api.test.ts
- 测试：tests/temporary-backend-sync.test.ts

**接口：**
- 输入：Task 1 与 Task 2 的云托管配置和统一客户端。
- 输出：文档准确描述云托管访问边界和真机验证条件。

- [x] **Step 1：更新后端访问文档**

将 README 与 HANDOFF 中的 wx.request、外部地址、合法 request 域名说明替换为云托管环境 ID、服务名、wx.cloud.callContainer、小程序与云托管服务绑定要求及真机验证项。

- [x] **Step 2：运行全量自动化测试**（执行完成；保留 7 项既有失败，详见本次交接说明）

运行：npm test

预期：通过，0 failed。

- [x] **Step 3：运行类型检查**

运行：npm run typecheck

预期：通过，0 TypeScript error。

- [x] **Step 4：进行静态边界检查**

运行：rg -n 'wx\.request|https://kistslor\.springboot-z3m5\.ffdpe5j4\.6culshnd\.com' miniprogram

预期：无运行时代码匹配；唯一的微信网络调用为 backend-api/request.ts 中的 wx.cloud.callContainer。

- [ ] **Step 5：真机验收**（待人工执行）

在微信开发者工具与真机上确认小程序已绑定云托管环境及服务，然后仅使用读取接口验证：云能力初始化成功、环境/服务路由正确、接口状态映射正确、BLE 启动与页面响应未被网络错误阻断。不得使用自动化或人工写入测试污染真实数据。
