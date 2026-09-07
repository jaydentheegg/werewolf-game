# PROGRESS.md · 当前进行状态（每次会话结束前更新，控制在半页内）

> 永久规则与项目地图看 CLAUDE.md。这里只写"现在改到哪、下一步做啥"。

## 当前功能：开场 → 纸张燃烧转场 → 邀请页暗夜改版（已提交 ✅，待真人点一遍）

**git 状态（2026-09-07 晚）：** main 分支，本功能已 commit。

### 已完成
- [x] **burn.js**：canvas 纸张燃烧转场，暴露 window.MidnightBurn.play({x,y,cover,done})
      — 纸从点击点烧开、噪波边缘、余烬火花；cover 回调时换页；尊重 prefers-reduced-motion
- [x] **midnight.js 接线**：NEW GAME / MULTIPLAYER / #castEnter → enter(mode, pointOf(e))
      → MidnightBurn.play；busy/无库/reduce 时兜底直接 reveal；焦点落到 #nameInp
- [x] **#invitation 暗夜改版**（midnight.css）：黑底 #030304 + 村庄图从右侧淡入
      （grayscale 遮罩）、hairline 分隔、白主按钮、表单玻璃化——和封面同一种"电影感"
- [x] 移动端适配（<=700px 遮罩改为纵向、表单转顶部边框）
- [x] 兜底链完整：无 GSAP / 无 MidnightBurn / reduce / busy → 直接 reveal，游戏始终可用
- [x] **版本号统一 bump 到 ?v=41**（含 style/midnight/motion/burn/net/game/compose/fx）
- [x] **零尺寸视口保护**：innerWidth/innerHeight 为 0 时（窗口折叠/隐藏）直接 cover+done，
      不再让 canvas 拿到 0 宽高在首次 drawImage 抛 InvalidStateError

### 本次验证到什么程度（重要，别当成"已人工验收"）
- 燃烧效果：用受控时钟逐帧驱动（替换 requestAnimationFrame），导出 150/480/820/1180ms
  四帧胶片图确认——种子火点 → 破洞+余烬环 → 参差火线横扫 → 近乎烧尽，边缘连通不碎块。
  另用 getImageData 抽样确认烧穿区 alpha=0（底下页面能透出来）。
- 邀请页样式：用 computed style 逐项确认（comp 面板 rgba(7,8,9,.85) 不再是米色、
  表单 blur(18px) 玻璃、主按钮白底黑字、标题 bone + 辉光、eyebrow 走 Arial Narrow 字距）。
- **没做到**：预览面板反复隐藏/不重绘，没能在可见浏览器里真正点一次 NEW GAME 走完整条链。
  下次开会话请先手动点一遍（见下）。

### 待办 / 下一步（按顺序）
1. [ ] **真人点一遍**：file:// 与 http server 各开一次——点 NEW GAME / MULTIPLAYER 看燃烧
      起点是否跟手、转场时长（约 1.5s）是否合适、邀请页露出与暗夜样式；
      键盘 Tab + Enter 激活菜单项时 pointOf 兜底（走元素中心）是否正常；
      reveal 后焦点到 #nameInp；系统开"减少动态效果"时应直接 reveal 不烧
2. [ ] 若嫌转场慢/快，调 burn.js 顶部 COVER_MS(260) / BURN_MS(1250) 两个常量即可
3. [ ] fx.js 在 #invitation 露出时会对新 DOM 做"电影化反馈"闪红——观察是否与新暗夜配色冲突

### 已知坑 / 注意
- #setup 区 = 封面 hero + 角色画廊 + 邀请页三段连续排布；转场是菜单→邀请页（同一 #setup 内）。
- 邀请页 id 勿动：#nameInp / #countSel / #rolePreview / #compEditor / #compToggle /
  #startBtn / #btnCreate / #btnJoin。
- .burn-layer z-index:90 固定全屏、运行中吞点击——验证时注意别挡住调试工具。
- 邀请页米色面板的根因是 .invitation 自己定义了一套浅色变量（--bg-sunk: #e7ddc8），
  .comp 吃的是这个变量；新样式用 #invitation 提高优先级整套改暗，别改回去。

## 已完成历史（摘要，勿删）
- ending screen 简化、title-screen hero art 右移加深（已 merge main + push）。
- 燃烧转场 + 邀请页暗夜改版（本次，已 commit）。
- 更多历史见 git log。
