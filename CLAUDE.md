# CLAUDE.md · MIDNIGHT 天黑请闭眼（狼人杀）

永久规则与项目地图。每次开会话自动加载；只放**不会变**的事实。
进行中的状态见同目录 PROGRESS.md。

## 项目本质
- 网页狼人杀（单机 + P2P 联机）。前端纯原生 HTML/CSS/JS，**无构建步骤**；
  另有一个很小的 Node 服务（server/），托管页面并让 AI 座位接入 Claude 思考。
- 打开方式：`npm start` → http://localhost:8787（AI 接入 Claude）；`npm run mock` 用离线模拟大脑。
  直接双击 index.html（file://）或任意静态服务器**必须仍然可用**——此时 AI 座位退回经典规则。
- 前端依赖：仅 GSAP 3（CDN，带 SRI integrity）；GSAP 被屏蔽时游戏仍完整可用（降级到 CSS）。
- 服务端依赖：仅 @anthropic-ai/sdk；Node ≥ 20.12。Key 放 .env（不提交）或环境变量。
- 联机走 Trystero P2P（免服务器、房间号发现）；加载失败只禁用联机，单机不受影响。
  AI 座位只在房主页面上思考，只有房主需要跑服务。

## 架构铁律（违反会出 bug）
1. **game.js 是唯一的状态与规则权威**。视觉层文件（fx/midnight/motion/burn/compose）
   只读它的 DOM 输出或调用它暴露的函数，绝不反向改它的内部状态。
2. **文件顺序 = 经典脚本，不能用 type="module"**（file:// 会拦截本地 ES Module）。
   加载顺序见 index.html 底部：motion → burn → net → ai → game → compose → fx → midnight → entry。
3. 夜间行动等"只发本人"的信息，身份注入保持静态 DOM，勿运行时插节点导致事件失绑。
4. #table 的 innerHTML 会被 game.js 整体重绘——装饰性节点要放在 wrapper 里，别放 #table 内。
5. AI 服务只出主意、不持有状态：game.js 把某个 AI 座位【能看到的】打包成 view（公开记录
   G.events + 它自己的 secrets + notes），**活人的身份绝不能进 view**；拿回的决定 game.js 必须再按
   规则校验，失败 / 超时 / 未接入一律退回经典规则 AI。新增公开事件记得 pubEvent()，私密信息用 secretTo()。
6. 夜里不许暴露「哪个 AI 在想」（thinking 标记只用于白天发言），否则等于公开神职身份。

## 文件分工
| 文件 | 职责 |
|---|---|
| index.html | 全部页面结构（封面 #setup / 邀请 #invitation / 大厅 #lobby / 对局 #game / 结算 #overlay）|
| style.css | 基础与对局 UI（圆桌、卡牌、面板、按钮、身份卡）|
| midnight.css | 「封面/开场」视觉主题（深色村庄 hero、字标、角色画廊、ENTRY MENU 开局清单）|
| game.js | 规则状态机：单机(本页=0号玩家+AI)、联机(房主=权威)、回合/行动/胜负；AI 座位的记忆与决策校验 |
| ai.js | 浏览器端 AI 接入层：探测 /api/ai、decide() 发请求（并发闸门 + 连续失败暂停重连）、BRAIN 抽屉，写 window.wwAI |
| server/index.js | Node 服务：托管静态页（不外露 server/、node_modules、点文件）+ /api/ai/status、/api/ai/decide |
| server/brain.js | 系统提示词、局面渲染、每个任务固定的 JSON schema、Claude 调用与结果校验 |
| server/mock.js | 离线模拟大脑（`--mock` / AI_MOCK=1），测试与调样式用 |
| midnight.js | 开场菜单交互：NEW GAME/MULTIPLAYER 入口、邀请页 reveal、menu panel |
| entry.js | 开局清单交互（邀请页 + 大厅）：选中行白笔触、抽屉开合、右侧摘要、共享控件搬家 |
| burn.js | 纸张燃烧转场（canvas，纯展示，不碰游戏状态）|
| motion.js | GSAP 动效层（时钟发言轨道、投票动画），无 GSAP 时降级 |
| compose.js | 首页"自定义阵营人数"，只收集配置并调 game.js 的 setCustomComposition() |
| fx.js | 视觉增强：昼夜氛围、emoji→原创 SVG 符号替换、DOM 变化→电影化反馈 |
| net.js | Trystero P2P 联机层，动态 import() 从 CDN 加载，成功后写 window.wwNet |

## 开场菜单 → 开局清单流程（当前结构）
- 按钮：.game-menu-item[data-menu-action=new|multi]，以及 #castEnter（角色区进入）。
- 点击 new/multi → midnight.js 的 enter(mode, origin) → MidnightBurn.play()（若
  减少动态偏好或 burn 不可用则直接落地）→ 燃烧覆盖层盖住后 land(mode)：
  · solo → reveal() 露出 #invitation（4 行：NAME / PLAYERS / ROLES / START GAME）
  · multi → game.js 的 enterMultiplayer()：直接建房 + 进 #lobby（6 行：ROOM CODE /
    LOBBY / NAME / PLAYERS / ROLES / START GAME；客人只见前三行 + READY）
- 加入别人的房间：大厅 ROOM CODE 抽屉里的 #joinCodeInp + #joinBtn。房间号对房主和
  客人都显示。
- 两块清单共用同一份 #nameInp / #compEditor（.entry-part），entry.js 按当前屏幕把它们
  搬进对应的 .entry-slot——所以 id 只有一份，game.js / compose.js 的绑定不用改。
- 联机人数以 #mpCountSel 为准、单机以 #countSel 为准；compose.js 按屏幕自动切换基准。

## 视觉语言（封面 midnight 主题，做样式时对齐它）
- 底色近黑带青：约 #121a1b；文案奶油色：约 #eee4ce；暖灰 #c8c4b8。
- 强调/灼痕：砖红 #d45a43 ~ #d95b45（血、狼眼、燃烧）；旧纸 #dfb18a。
- 字标：Georgia serif，负字距（letter-spacing: -.085em 级别），全大写+中文副题。
- 背景资产：assets/midnight-village.jpg（hero）、assets/midnight-characters.webp（立绘）、
  assets/gilded-frame.svg（画框）。
- 动效：unveil/riseIn 类关键帧 + GSAP；都尊重 prefers-reduced-motion。

## 改动纪律
- 一个会话做一个功能；改完 commit（信息写清做了什么），关会话前更新 PROGRESS.md。
- 改了 CSS/JS 记得 bump index.html 里的版本号 ?v=NN（当前全部 v=44）。
- 改了 server/ 跑 `npm test`（不需要 API Key，Claude 一侧用本地假服务顶替）。
- 别删历史文件；要并存就新建（例如 burn.js 就是新增而非改 fx.js）。
