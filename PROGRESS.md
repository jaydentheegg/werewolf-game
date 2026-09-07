# PROGRESS.md · 当前进行状态（每次会话结束前更新，控制在半页内）

> 永久规则与项目地图看 CLAUDE.md。这里只写"现在改到哪、下一步做啥"。

## 当前功能：邀请页 / 大厅改成「封面同款」开局清单（已实现 ✅，缺真人看一眼）

**git 状态（2026-09-07 深夜）：** main 分支，本功能待 commit / 已 commit（见 git log）。

### 这次做了什么
把 #invitation 与 #lobby 从「表单面板」改写成和封面 .game-menu 同一套语言：
居中的大写清单，选中行被白色笔触盖住（.entry-brush，clip-path 与封面同一多边形），
真正的控件收进该行下方的抽屉。左侧那段「今夜，为你留座」的文案整块删掉了。

- [x] **新增 entry.js**：选中行（hover/focus/↑↓）、抽屉一次只开一个、Esc 收起、
      右侧摘要（昵称 / 人数 / 狼X·好人Y / 房间号 / 在席人数）、复制房间号、返回主菜单
- [x] **midnight.css 新增 ENTRY MENU 段**（替换原 #invitation 段）：.entry-screen /
      .entry-menu / .entry-item / .entry-brush / .entry-drawer / .entry-chips / .entry-meta，
      两块屏幕共用；村庄图仍从右侧渗入（.entry-bg）
- [x] **单机 4 行**：NAME / PLAYERS / ROLES / START GAME（原来的创建房间、加入房间、
      玩法速览、分隔线全部撤掉）
- [x] **大厅 6 行**：ROOM CODE / LOBBY / NAME / PLAYERS / ROLES / START GAME；
      客人只见前三行 + READY。**房间号对房主和客人都显示**（game.js 里客人也写 roomCodeTxt）
- [x] **人数改成筹码排（6–12）**驱动原来的 <select>；select 保留为无 JS 时的兜底
- [x] **共享控件搬家**：#nameInp / #compEditor 只有一份 DOM（.entry-part），entry.js 按
      当前屏幕搬进 .entry-slot——id 不变，game.js / compose.js 的绑定一行没动
- [x] **MULTIPLAYER 直接进大厅**：midnight.js land('multi') → game.js 新增 enterMultiplayer()
      （自动建房、昵称为空时先补一个），加入别人的房间走大厅 ROOM CODE 抽屉里的输入框
- [x] **大厅内改昵称实时同步**：game.js 新增 setNickname() + 房主处理 'rename' 消息
- [x] compose.js 按屏幕切换人数基准（大厅用 #mpCountSel），切屏时重新校验；
      配置非法时给 #mpStartBtn 打 dataset.compBad，game.js 的 updateLobbyControls 尊重它
- [x] 版本号全量 bump 到 ?v=42，新增 <script src="entry.js?v=42">

### 本次验证到什么程度（重要，别当成"已人工验收"）
浏览器预览面板这次是**隐藏状态**（document.hidden=true、innerWidth=0、rAF 冻结），
截图只能拿到黑帧，所以**没有像素级验收**。改用 DOM / computed style 逐项确认：
- 4 行 / 6 行的 key·value·caption 与 id 都对；hover 第二行 → 该行 brush 矩阵变
  matrix(1,0,0,1,0,0)、其余仍是 scaleX(0)、文字翻成 rgb(8,9,10)、中文副标 opacity 1
- 抽屉互斥开合 + aria-expanded 同步；筹码点 10 → countSel=10、摘要与 compTally 同步
- 大厅（模拟 host/client）：房间号、名单人数、host 专属行的显隐、READY 改字后
  .entry-brush 仍在（没被 textContent 抹平）
- 真跑了一次 enterMultiplayer()：trystero 加载成功、MODE=host、房间号 PFTSD 上屏、
  大厅里改名 → 名单实时变
- 真跑了一次单机开局：8 座发牌、进对局屏、控制台零报错
- 短暂可见的那一帧量到：1440 宽视口下菜单 x=340 / width=760（正中），行高 62px

### 待办 / 下一步（按顺序）
1. [ ] **打开浏览器面板真人看一遍**（本地 node 静态服 8781，或直接双击 index.html）：
      笔触是否跟手、抽屉展开后整屏会不会挤、村庄图与白笔触的对比度、手机窄屏
2. [ ] 两台设备真联机一次：A 点 MULTIPLAYER 拿码 → B 点 MULTIPLAYER 后在 ROOM CODE
      抽屉里输码加入 → 看名单 / 改名 / 准备 / 开局
3. [ ] 我自作主张保留了两个"非选项"的东西：邀请页的「← 返回主菜单」和大厅的
      「← 离开房间」（都在底部小字行）。不想要就删掉这两个 .entry-back

### 已知坑 / 注意
- #invitation 已经不带 .invitation 类了（改用 .entry-screen），style.css 里那套米色
  .invitation 变量因此彻底失效——这是有意的，别再把类加回去。
- game.js 写 #mpReadyBtn 文案必须走 setEntryLabel()，直接 textContent 会把行内结构抹平。
- .entry-part 会在两块屏幕之间移动，任何新代码都别缓存它们的 parentElement。
- 预览面板隐藏时 rAF 冻结 → 燃烧转场会卡在 busy、截图全黑，不是代码坏了。

## 已完成历史（摘要，勿删）
- ending screen 简化、title-screen hero art 右移加深（已 merge main + push）。
- 燃烧转场 + 邀请页暗夜改版。
- 开局清单改版（本次）。
- 更多历史见 git log。
