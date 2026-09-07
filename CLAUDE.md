# CLAUDE.md · MIDNIGHT 天黑请闭眼（狼人杀）

永久规则与项目地图。每次开会话自动加载；只放**不会变**的事实。
进行中的状态见同目录 PROGRESS.md。

## 项目本质
- 网页狼人杀（单机 + P2P 联机），纯原生 HTML/CSS/JS，**无构建步骤**。
- 打开方式：直接双击 index.html（file:// 必须可用）或任意静态服务器。
- 依赖：仅 GSAP 3（CDN，带 SRI integrity）；GSAP 被屏蔽时游戏仍完整可用（降级到 CSS）。
- 联机走 Trystero P2P（免服务器、房间号发现）；加载失败只禁用联机，单机不受影响。

## 架构铁律（违反会出 bug）
1. **game.js 是唯一的状态与规则权威**。视觉层文件（fx/midnight/motion/burn/compose）
   只读它的 DOM 输出或调用它暴露的函数，绝不反向改它的内部状态。
2. **文件顺序 = 经典脚本，不能用 type="module"**（file:// 会拦截本地 ES Module）。
   加载顺序见 index.html 底部：motion → burn → net → game → compose → fx → midnight。
3. 夜间行动等"只发本人"的信息，身份注入保持静态 DOM，勿运行时插节点导致事件失绑。
4. #table 的 innerHTML 会被 game.js 整体重绘——装饰性节点要放在 wrapper 里，别放 #table 内。

## 文件分工
| 文件 | 职责 |
|---|---|
| index.html | 全部页面结构（封面 #setup / 邀请 .invitation / 大厅 #lobby / 对局 #game / 结算 #overlay）|
| style.css | 基础与对局 UI（圆桌、卡牌、面板、按钮、身份卡）|
| midnight.css | 「封面/开场」视觉主题（深色村庄 hero、字标、角色画廊、邀请页 prologue）|
| game.js | 规则状态机：单机(本页=0号玩家+AI)、联机(房主=权威)、回合/行动/胜负 |
| midnight.js | 开场菜单交互：NEW GAME/MULTIPLAYER 入口、邀请页 reveal、menu panel |
| burn.js | 纸张燃烧转场（canvas，纯展示，不碰游戏状态）|
| motion.js | GSAP 动效层（时钟发言轨道、投票动画），无 GSAP 时降级 |
| compose.js | 首页"自定义阵营人数"，只收集配置并调 game.js 的 setCustomComposition() |
| fx.js | 视觉增强：昼夜氛围、emoji→原创 SVG 符号替换、DOM 变化→电影化反馈 |
| net.js | Trystero P2P 联机层，动态 import() 从 CDN 加载，成功后写 window.wwNet |

## 开场菜单 → 邀请页流程（当前结构）
- 按钮：.game-menu-item[data-menu-action=new|multi]，以及 #castEnter（角色区进入）。
- 点击 new/multi → midnight.js 的 enter(mode, origin) → MidnightBurn.play()（若
  减少动态偏好或 burn 不可用则直接 reveal()）→ 燃烧覆盖层盖住后 reveal(mode, true)
  切到 #invitation（昵称/人数/角色配置/开局）。
- reveal(mode) 的 mode = solo | multi；multi 会高亮 #btnCreate/#btnJoin。

## 视觉语言（封面 midnight 主题，做样式时对齐它）
- 底色近黑带青：约 #121a1b；文案奶油色：约 #eee4ce；暖灰 #c8c4b8。
- 强调/灼痕：砖红 #d45a43 ~ #d95b45（血、狼眼、燃烧）；旧纸 #dfb18a。
- 字标：Georgia serif，负字距（letter-spacing: -.085em 级别），全大写+中文副题。
- 背景资产：assets/midnight-village.jpg（hero）、assets/midnight-characters.webp（立绘）、
  assets/gilded-frame.svg（画框）。
- 动效：unveil/riseIn 类关键帧 + GSAP；都尊重 prefers-reduced-motion。

## 改动纪律
- 一个会话做一个功能；改完 commit（信息写清做了什么），关会话前更新 PROGRESS.md。
- 改了 CSS/JS 记得 bump index.html 里的版本号 ?v=NN（当前主体 v=40，burn.js 已 v=41）。
- 别删历史文件；要并存就新建（例如 burn.js 就是新增而非改 fx.js）。
