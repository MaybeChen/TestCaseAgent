# Playwright Semantic Recorder

基于公开 Playwright API 的语义增强录制器 MVP。需要 Node.js 22+。本项目提供 Library 和 CLI，不生成语义步骤，不调用 LLM，不自动回放。

## 安装与启动

```bash
cd semantic-recorder # 从仓库根目录进入
npm ci
npx playwright install chromium
npm run build
npm run record -- --url https://example.com/users --output recordings/demo
```

默认打开独立、有头 Chromium。Ctrl+C、SIGTERM、关闭最后一个标签页或浏览器、到达时长上限时，保存 `recordings/demo/semantic-trace.json`。已有同名文件会拒绝覆盖，请每次使用新目录。输入的 output 是目录而非文件名。

当前云环境已有 Chromium，下载 Playwright 浏览器时网络策略会阻止 `cdn.playwright.dev`，可直接使用已安装版本：

```bash
export SEMANTIC_RECORDER_CHROMIUM_PATH=/usr/bin/chromium
npm run build
npm test
npm run record -- --url about:blank --output recordings/headless-demo --no-headed --max-duration 5
```

显式系统浏览器路径是可选兼容方式，常规安装优先使用 Playwright 配套版本。无图形桌面的云环境使用 `--no-headed`；人工操作的有头模式需要本地桌面或现有显示服务。本次云验证使用 Chromium 154，安装的 Playwright 版本见 lockfile。

参数：`--url`、`--output` 必填；`--goal` 记录任务目标；`--headed` 默认；`--no-headed` 无头；`--max-duration` 单位秒，必须大于 0。

## 本地动态 ID 示例

终端一：`npm run fixture`（端口 4173）。终端二：

```bash
npm run record -- --url http://127.0.0.1:4173 --output recordings/users --goal '删除并重建用户'
```

初始用户为 `zhangsan / zhangsan@example.com`，ID 为 1001。点击删除、确认，再填写同名用户并新增，下一条 ID 固定为 2058，随后按 1057 递增。每次重新加载页面重置数据。测试服务不访问外网。

## Library

先运行 `npm run build`，可从 `./dist/index.js` 导入：

```typescript
import { RecorderSession } from './dist/index.js';
const session = await RecorderSession.start({
  url: 'http://127.0.0.1:4173', output: 'recordings/library-demo',
  headed: false, maxDuration: 60, maxEvents: 10000, maxBytes: 10 * 1024 * 1024
});
await session.page.locator('#delete-1001').click();
const { path, trace } = await session.stop(); // 幂等；关闭自有浏览器并等待保存
// 也可以 await session.done，等待关闭或时长上限触发的自动结束。
```

`session.flush()` 是终止采集并清空页面输入及传输队列的底层操作，之后请调用 `stop()`。该 API 不用于周期性保存；正常事件会自动 checkpoint。传入的浏览器由 session 自行创建和释放。

## 数据契约与证据边界

- Zod 定义位于 `src/domain/semantic-trace.ts`；独立 JSON Schema 位于 `schema/semantic-trace-1.0.schema.json`，构建时同步到 dist。消费方应以 `schemaVersion` 分派版本。Zod 另外验证顺序、事件 ID、状态关联和 valueRef 的完整性，JSON Schema 消费者需要自行实现这些跨字段检查。
- `values` 是 valueRef 字典。事件输入值、身份候选通过引用访问；容器字段也保留有长度上限的可观察值。原始 DOM ID 仅是 target/locatorRisk 证据，不是业务身份。
- `sequence` 表示 Node 接收顺序；`timestamp` 是浏览器采集时间（fill 为会话起始时间），`receivedAt` 是接收时间。跨页面无法保证全局用户因果顺序，保留 documentId/localSequence、pageId/frameId/frameUrl 辅助分析。
- 输入在 change、失焦、提交、其他目标点击、pagehide、停止时合并。并非每个按键一个步骤，不依赖固定 debounce 判断输入结束。停止/卸载时未完成会话标记 incomplete。
- 捕获阶段同步保存上下文，因此 onclick 立即移除节点仍有前置证据。表格优先匹配 headers、aria-colindex 或单行无跨度表头；复杂跨行表头保留序号和 incomplete，不猜列名。保留 table row、form、dialog、list/card 层级；普通 div 不推断为业务实体。
- accessibleName 是带 `nameSource`、`nameIsCandidate` 的候选值，未声称实现完整 Accessible Name 规范。
- 状态关联使用 MutationObserver 的短暂收敛窗口和 800ms 上限。仅 URL、弹窗、状态提示、目标移除等有证据变化标 observed；无变化或超时标 unknown。DOM 稳定、提示出现都不是业务成功的断言；并发动作可能共同影响观察窗口，关联不是因果证明。
- 用户名、邮箱、订单号、客户名称等仅作候选；不声明全局唯一，也未测当前视图唯一性。数据库 ID 不自动成为身份候选。静态规则无法确定稳定性的 ID 标 unknown，包括 step-1、tab-2。

## 隐私、上限与保存

密码、current/new-password、一次性验证码、银行卡号/安全码和 `data-recorder-sensitive` 标记的控件/祖先在浏览器中替换为 `[REDACTED]`，不把明文经 binding 传给 Node。文本摘要移除 input、textarea、script/style 和显式敏感区。其余字段仍可能包含个人信息；这不是通用 DLP，请在网站敏感区域使用该属性，并审查录制文件和 URL（可能含查询参数）。不采集 cookies、网络请求体、文件内容或认证存储。

默认每次录制最多 10000 个事件、10 MiB 文件，单次桥接消息 64 KiB，文本和值有长度上限；超出事件数时丢弃后续动作并告警，字节预算不足时丢弃最新事件并终止保存有效 trace。保留完整录制文件，**不自动删除历史录制**，由用户按需要清理 recordings；同名文件不会复用。每次接受消息后通过队列串行验证并临时文件原子替换。写入失败会告警，最终保存失败会使 CLI 非零退出。SIGKILL/系统断电无法确保最终 flush，只能保留上次成功 checkpoint；未提供磁盘 fsync 级断电保证。

监听不阻止传播、不修改业务数据。`isTrusted` 只过滤普通脚本合成事件，不是防篡改边界。浏览器关闭、跨文档卸载、页面崩溃时可能丢失尚未跨桥接的事件，会保留 warning。暂不支持闭合 Shadow DOM、文件上传、canvas、原生 JS confirm/prompt 的完整录制；原生 checkbox/select 和 HTML dialog 受支持。iframe 初始化脚本支持跨域 frame，但特殊沙箱/禁用脚本页面可能无法采集。语义信息不完整时必须查看 warnings 和容器标记。

## 验证

```bash
npm run typecheck
npm test                 # build + 全部单元/真实浏览器集成测试
npm run test:unit
npm run test:integration
```

集成测试启动仅监听 loopback 的 HTTP fixture 服务，真实点击、逐字输入、删除、重建、iframe 和 popup，不使用脚本伪造用户事件替代录制验证。测试结束关闭所建浏览器/服务并清理临时录制。

模块边界：Browser 管理生命周期与 bridge；Injected 负责同步采集、容器解析、输入会话及状态观察；Processing 负责标准化、定位风险、身份候选和状态关联；Domain 定义版本化契约；Storage 负责验证、排队和防覆盖文件保存。浏览器输入会话位于 Injected，避免逐键传输敏感数据。
