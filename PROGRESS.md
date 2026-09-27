# PROGRESS.md · 当前进行状态（每次会话结束前更新，控制在半页内）

> 永久规则与项目地图看 CLAUDE.md。这里只写"现在改到哪、下一步做啥"。

## 当前功能：人物卡去掉画框（已实现 ✅）

**git 状态（2026-09-27）：** 分支 claude/practical-cray-nxte8b，已 commit + push。版本号全量 bump 到 ?v=47。

第三轮（建议 2）：界面文字里的 emoji → 原创符号（fx.js「九·二」）
- game.js 的字符串一个没改（它们也进 G.events 给 AI 看、也广播给客人）；fx.js 在 body 上挂 MutationObserver，
  把文本节点里的 emoji 换成 <ww-glyph>：角色 → 原有 sig-*；🌙🌑 → sig-moon，☀️🌅 → sig-sun，☠️ → sig-death（index.html 新增三枚）；
  其余装饰 emoji（👑🗣️🗳️⚖️🧠…）连同后面的空格藏掉。过场大字（#veil）里一律藏掉，圣像徽章已经表达了角色。
- 原 emoji 留在视觉隐藏的 <ww-glyph-src> 里 → textContent 不变：身份卡识别、结算 fx-win-*、保存故事、读屏都照旧。
- 必须用自定义标签：`.ovroles span`、`.comic-panel span` 这类泛 span 选择器会给 span 套边框 / 大字号。
- 跳过 .avatar、#rolePreview（各有自己的替换）、option/select/textarea、svg。镂空色走 --glyph-cut（!important，
  防 day 相位的 `.card .sigil` 浅色镂空）；狼 / 骷髅固定砖红 #d95b45。
- 验证：mock 整局跑到结算，全程扫描可见文本无 emoji 泄漏；file:// 正常；2x 屏下符号清晰。1x 下村民符号略像「0」（原有 sigil，旁边总跟着「村民」二字）。

第二轮（用户从建议里挑了 1 / 4 / 7）：
- 发言钟面整体下移 84px（.tablewrap 470→554、.table inset-top 84px、表盘弧线 72→156px）：放大的发言人卡顶
  原来被裁掉 54px，XII 压在脸上；现在卡完整，XII 在它头顶（top 8px）。GSAP / --clock-x/y 都相对 .table，不受影响。
- 身份卡遮罩背景 #11191b → #030304，与对局纯黑一致。
- 发言输入框提示改短为「例：我是预言家，小明是狼」，1050px 宽（最窄桌面侧栏）也放得下。
- 顺手修：白天旧规则 `html[data-phase="day"] #game .card` 的内描边优先级高过无框规则，
  在半透明的出局卡上透出一圈框——已删。
- 封面角色画廊：去掉 gilded-frame 细金框和卡片顶部分隔线；罗马数字加阴影直接压在插画上。
- 身份卡：去掉 reliquary 金红画框、叶饰 .card-ornament、1px 描边和硬投影，改成柔和大阴影；
  文字不用再躲画框，内边距收小（桌面 40/32/30，手机 34/24/26）。.idcard-sigil 原本被画框盖住，一并隐藏。
- 圆桌卡牌 v36 起就已无框，这次只删掉了已被覆盖掉的画框背景声明。
- index.html 去掉 reliquary-frame.webp 的 preload（没人用了，省约 340KB）。素材文件保留未删。
- 验证：Playwright 截图 1440 / 390 宽的画廊、身份卡、白天圆桌；无 pageerror；画框素材不再被请求。

## 上一个功能：AI 玩家接入 Claude、自己思考（已实现 ✅）

### 这次做了什么（版本号全量 bump 到 ?v=44）
- 新增 Node 服务（package.json / server/）：`npm start` 托管页面 + `/api/ai/*`；默认 claude-opus-5、
  effort=low、自适应思考、结构化输出（每个任务一份固定 schema）、refusal 自动 fallback；
  参数被网关拒收时自动降级重试。默认只监听 127.0.0.1，挡 Host / Origin 跨站调用。
- 每个 AI 座位：性格 persona、私人笔记 notes（每次决策后自己改写）、私密信息 secrets、心声 minds。
  任务：发言 / 投票 / 狼人夜袭 / 预言家查验 / 女巫用药 / 猎人开枪。
- 狼人夜里「商量」：AI 狼依次提议（后说的能看到前面的提议和理由），真人狼能看到提议，真人的票说了算。
- AI 预言家与狼人同时开始想（省一轮等待）；所有 AI 的投票并行思考（ai.js 并发上限 4）。
- 票型改为公开（新增「🗳️ 票型」一行）——AI 推理要用，真人也该看到同样的信息。
- 白天发言时 AI 卡片显示「思考中…」，导演面板显示等待提示；联机时同步给客人（夜里不显示）。
- 终局「AI 心声回放」；单机可开「旁观心声」实时看 AI 内心独白（剧透）。
- 容错：未接入 / 超时 / 答非所问 → 这一次退回经典规则；连续 3 次上游失败 → 暂停 30 秒再重连，纪事里提示。

### 验证方式
- `npm test`：12 项（局面渲染不泄露活人身份、决定校验、假 Claude API 检查真实请求体、服务端访问控制）。
- Playwright：mock 大脑单机整局；假 Claude API（走真实 SDK）整局 + 中途断线；file:// 打开退回规则；
  假 Trystero 的房主 + 远端玩家整局（thinking / over 带心声，旁观心声不外泄）。
- **没有用真 API Key 跑过**：沙箱里没有 Key。

### 待办 / 下一步（按顺序）
1. [ ] 配上真 Key 打一局，看 Claude 的发言质量、每步耗时；按需调 AI_EFFORT 或提示词（server/brain.js）
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
- AI 玩家接入 Claude。
- 人物卡去掉画框（本次）。
- 更多历史见 git log。
