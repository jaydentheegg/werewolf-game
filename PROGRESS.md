# PROGRESS.md · 当前进行状态（每次会话结束前更新，控制在半页内）

> 永久规则与项目地图看 CLAUDE.md。这里只写"现在改到哪、下一步做啥"。

## 当前功能：页面上填 API Key（已实现 ✅）

**git 状态（2026-09-27）：** 分支 claude/game-ai-opponent-thinking-fet57h（从 main 重新拉起，上一轮 PR #4 已合并），已 commit + push。

### 这次做了什么（版本号 bump 到 ?v=45）
- BRAIN 抽屉新增 API Key 输入：没接上时直接显示输入框；接上后显示「当前 Key：sk-ant-…1234（来源）」+ 更换 / 移除。
- 服务端 /api/ai/key：POST 先用 models.retrieve 验证（不花 token），能用才换上；勾「记住」只改写 .env 里
  ANTHROPIC_API_KEY 那一行（其他行原样保留）；DELETE 移除。环境变量来的 Key 页面上删不掉（409）。
- 安全：Key 只收本机来源的请求（remoteAddress 是 loopback），格式只许可见 ASCII（防往 .env 注入换行），
  响应里永远只有打码尾巴；浏览器里输入框提交后立刻清空，localStorage 只存开关偏好。
- entry.js：抽屉展开时跳过隐藏的控件去聚焦。

### 上一轮：AI 玩家接入 Claude（PR #4 已合并，?v=44）
Node 服务 + Claude 大脑（每个 AI 有性格 / 笔记 / 私密信息，狼人夜里商量，票型公开，终局心声回放，
失败退回经典规则、连续失败暂停重连）。细节见 git log 855179d 与 CLAUDE.md。

### 验证方式
- `npm test`：14 项（局面渲染不泄露活人身份、决定校验、假 Claude API 检查真实请求体、服务端访问控制、
  页面填 Key：坏 Key 不换上 / 好 Key 写进 .env 且从不回显 / 移除后 .env 只少那一行）。
- Playwright：BRAIN 抽屉填错 Key → 报错、填对 → 已连接、刷新后仍记得、手机上移除（桌面 + 手机截图核对）。
- Playwright：mock 大脑单机整局；假 Claude API（走真实 SDK）整局 + 中途断线；file:// 打开退回规则；
  假 Trystero 的房主 + 远端玩家整局（thinking / over 带心声，旁观心声不外泄）。
- **没有用真 API Key 跑过**：沙箱里没有 Key。

### 待办 / 下一步（按顺序）
1. [ ] 在页面上填真 Key 打一局，看 Claude 的发言质量、每步耗时；按需调 AI_EFFORT 或提示词（server/brain.js）
2. [ ] 两台设备真联机一次（房主跑服务 + AI 座位）
3. [ ] 「← 返回主菜单」「← 离开房间」两个 .entry-back 是否保留，等用户定

### 已知坑 / 注意
- `npm test` 的 glob 要带引号（"server/*.test.js"）；写成 `node --test server/` 会把 index.js 当测试跑起来卡住。
- 服务端的 schema 必须固定（不要把可选目标做成 enum）——每换一次 schema 都要重新编译、变慢。
- ai.js 的 fetch 用相对路径 `api/ai/...`，挂在子路径下的反向代理也能用。
- #invitation 已经不带 .invitation 类了（改用 .entry-screen）；game.js 写 #mpReadyBtn 文案必须走 setEntryLabel()；
  .entry-part 会在两块屏幕之间移动（现在有 name / roles / brain 三块），别缓存它们的 parentElement。
- 客户端只处理房主消息，新增消息类型放进 fromHost 分支（这次加了 thinking）。

## 已完成历史（摘要，勿删）
- ending screen 简化、title-screen hero art 右移加深（已 merge main + push）。
- 燃烧转场 + 邀请页暗夜改版。
- 开局清单改版。
- 全量 bug 排查修复 13 项。
- AI 玩家接入 Claude（PR #4，已合并）。
- 页面上填 API Key（本次）。
- 更多历史见 git log。
