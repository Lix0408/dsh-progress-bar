# dsh-progress-bar

DeepSeek Harness Web 客户端的**会话头部进度控件**：一个真实的完成百分比徽标 + 迷你进度条，点开是本会话的任务清单与后台作业列表。

> 一句话原则：**只显示能证明的数字。**
> 百分比只有一个来源（会话的 `todos` 投影）。后台作业的 `progress` 是**字符串**（一行进度文案），它永远不会被换算成百分比，也不会和任务清单加总成"综合进度"。

---

## 它显示什么 / 不显示什么

| 场景 | 头部显示 | 说明 |
|---|---|---|
| 会话有 `todos` 清单 | `3/7 · 43%` + 迷你进度条 | 百分比 = `completed / total`，**唯一**的真实百分比 |
| 无清单，但有运行中的后台作业 | `运行中 · 12秒` | 12 秒是**那个作业自己的** `startedAt → now` |
| 无清单、无作业，但会话在运行 | `运行中` | 不定态流动条；**不显示任何计时器** |
| 以上三者皆无 | **不渲染任何节点** | 空转的计时器是噪音，也会误导人以为有任务在跑 |

---

## 效果截图

截图位置：`docs/screenshot.png`（**尚未提供**——本仓库目前不含图片资源，`docs/` 目录下暂为空缺）。

建议补图两张并保持同名：

- `docs/screenshot.png` —— 收起态：头部徽标 `3/7 · 43%`（待补）
- `docs/screenshot-panel.png` —— 展开态：任务清单 + 后台作业 + 进度条（待补）

---

## 安装

本插件是标准的 dsh 双面包（host 半为空 `apply`，浏览器半提供全部功能），通过 `dsh.bundle.patch` 自带挂载层，安装后无需手改 profile。

```bash
# 官方 CLI（会读取本包的 cordis.patch.yml，自动追加到 profile 的 bundle 栈）
dsh plugin --profile <profile-name> add dsh-progress-bar@<version>
```

手动安装（把包放进 profile 的依赖后）：

```bash
cd ~/.dsh/profiles/<profile-name>
pnpm add dsh-progress-bar@<version>      # 或在 package.json 里加依赖后 pnpm install
# 然后在 profile 的 cordis.patch.yml 里加：
# - insert:
#     - id: progress-bar
#       name: 'dsh-progress-bar'
```

安装后**硬刷新浏览器**（Ctrl/Cmd+Shift+R）。client 半改动无需重启 dsh。

卸载：`dsh plugin --profile <profile-name> remove dsh-progress-bar`，并确认 profile 里没有残留的手动挂载行（同包双挂载会得到两份 Node 半）。

---

## 数据源与语义

| 数据 | 来源 | 类型（权威声明） |
|---|---|---|
| 任务清单 | `useProjection('todos')` 会话投影 | `TodoItem[] \| null`，`TodoItem = { content: string; status: 'pending' \| 'in_progress' \| 'completed' }` |
| 后台作业 | `ctx.jobs.state`（`dsh-api-job-controller` 安装的按引用计数服务），`watchRows(sessionId)` 跟随名册 | `JobView`：`id / kind / label / status / progress? / detail? / startedAt / finishedAt? / output.total` |
| 是否在运行 / 是否在等你确认 | `useSession(s => s.running)`、`useSessionStatus(snapshot => snapshot.get(sessionId)?.pendingInteraction)` | `SessionSnapshot.running`、`SessionStatus.pendingInteraction` |

注册位置：插槽 `conversation.session.header.actions`（`kind: 'list'`、`scope: 'session'`），条目 `id: 'progress'`、`order: 30`（官方 `job-list` 是 20，本插件排在其后）。

### 降级行为

- **首次 `todo_write` 之前**，`todos` 投影为 `null`；宿主未挂 `ctx.sessionProjections` 时该键永远缺失。两种情况下都**不显示百分比**，进度条退化为不定态，并显示说明文案。
- 宿主重启会丢失作业环与名册；重连后首帧即为完整事实。
- `output.total` 是**保留字节数**，只用于显示"保留输出 1.2 MB"，不代表工作量。

---

## 已知限制

1. **不显示"本轮已运行多久"。** `SessionSnapshot` 的权威字段里**没有**回合起点时间戳（只有 `sessionId / pendingSubmissions / running / subagent / removed / openState / openError / hasMore / loadingOlder / promptError / blank / lastAgentError / promptAttempted / awaitingFirstTurn`），而 `ui-conversation` 的 `openTurn()` 返回的是**回合编号**而非时间。因此本插件只显示后台作业自己的耗时；"运行中但无作业"时只显示"运行中"。这是有意为之：宁可少一个数字，也不要一个刷新后就错的数字。
2. **只读。** 不提供 kill / 停止按钮，也不展开作业输出终端。
3. **CSS Modules 只支持相对路径导入**（`./X.module.css`）。从 `node_modules` 引入的 `.module.css` 不在自写 CSS 插件的解析范围内。
4. `pendingInteraction` 只做存在性判断，不展示具体交互内容。
5. 进度依赖模型遵守 `todo_write` 的约定：模型不更新清单时百分比会滞后——这是数据本身的语义，不是估算误差。

---

## 开发与构建

前置：Node ≥ 20、pnpm ≥ 10（本机验证于 Node 24.21.0 / pnpm 11.7.0）。

```bash
pnpm install --node-linker=hoisted   # 见下方说明
pnpm typecheck                       # tsc --noEmit，期望无输出、exit 0
pnpm build                           # → lib/index.js + lib/client.js + lib/types/**
pnpm watch                           # tsdown --watch
```

> **为什么要 `--node-linker=hoisted`**：pnpm 默认的 isolated 布局在 Windows + 长路径下会 `[ERR_PNPM_SYMLINK_FAILED] Maximum call stack size exceeded`。本机真实 profile 用的也是 hoisted 布局。

### 构建产物（本仓库 `lib/` 不入 git，仅构建时生成）

```
lib/index.js                     Node 半（ESM）
lib/client.js                    浏览器半（CJS + __ModuleLoader__ 包装）
lib/types/index.d.ts              Node 半类型
lib/types/client/index.d.ts       浏览器半类型
```

### 产物自检

```bash
node -e "const s=require('node:fs').readFileSync('lib/client.js','utf8');for(const [k,p] of Object.entries({loader:/^window\.__ModuleLoader__\.load\(\{/,mod:/var module = \{ exports: \{\} \};/,exp:/var exports = module\.exports;/,react:/require\(\"react\"\)/,prims:/require\(\"@deepseek-ai\/dsh-client-ui-primitives\"\)/,apply:/exports\.apply/,inject:/exports\.inject/,css:/data-plugin-css/,tail:/return module\.exports;\s*\}\s*\}\);/}))console.log(k,p.test(s)?'PASS':'FAIL')"
```

预期 9 行全 `PASS`。

### 构建配置为什么是自包含的

官方 monorepo 的 `packages/client/tsdown.client.ts`（`clientBundle()` 预设）不随 npm 发布物分发，独立仓库拿不到。本仓库用 `tsdown.config.ts` + `tsdown.client-css.ts` 等价实现其四项职责：

1. **JSX/TSX**：`jsx: react-jsx`（automatic runtime）。
2. **CSS Modules**：自写 rolldown 插件用 `lightningcss` 编译 `.module.css`，产出**扁平类名映射**并把编译后的 CSS 作为字符串内联、由模块自己注入 `<style data-plugin-css="<pkg>/<相对路径>">`。虚拟模块 id 形如 `\0dsh-css:<绝对路径>.module.css.mjs`——末尾的 `.mjs` 是必需的，用来躲开 CSS 插件对 `.css` 后缀的 id 过滤（照抄官方预设的做法）。
3. **模块包装**：`format: 'cjs'` + `banner`/`footer` 生成宿主要的 `window.__ModuleLoader__.load({ id, factory: (require) => { var module = { exports: {} }; var exports = module.exports; … return module.exports; } })` 闭包。
4. **externals**：`deps.neverBundle`（`external` 在 tsdown 0.22 已废弃）列出 `react` / `react-dom` / `react/jsx-runtime` / `@deepseek-ai/*`，让它们保持 `require(...)`；其余依赖内联。

---

## 验证基线

- 开发与构建验证于 **dsh 0.2.0-rc.2**（`~/.dsh/dsh-runtimes/*/runtime.json` 的 `desktopVersion`，且运行时里全部 `@deepseek-ai/dsh-client-*` 均为 `0.2.0-rc.2`）。
- 类型与运行时 API 均取自该版本**已发布的 `.d.ts` 与已编译产物**，未使用推测字段。
- npm 上这些包的 `next` 通道即 `0.2.0-rc.2`；`alpha` 通道为 `0.2.1-alpha.1`（更新，但未在本机运行时验证）。

---

## 目录结构

```
src/index.ts                    Node 半（空 apply，占一个 Loader 行）
src/client/index.ts             inject + apply：注册词典、注册 header action
src/client/ProgressBadge.tsx     触发器 + 展开面板（唯一组件）
src/client/progress.ts           纯函数：计数 / 百分比 / 时长拆分 / 字节（无 React）
src/client/locales.ts            NS='progress'，zh 为键集合事实源，en 键完全对齐
src/client/ProgressBadge.module.css
src/client/css-modules.d.ts
tsdown.config.ts                两个入口：Node 半 + 客户端半
tsdown.client-css.ts            CSS Modules 插件
tsconfig.json / tsconfig.build.json
cordis.patch.yml                dsh.bundle.patch 挂载层
```

---

## 许可

本仓库暂未附带 LICENSE 文件。在补充之前，请视为"保留所有权利"。
