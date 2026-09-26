# PROGRESS.md · 当前进行状态（每次会话结束前更新，控制在半页内）

> 永久规则与项目地图看 CLAUDE.md。这里只写"现在改到哪、下一步做啥"。

## 当前功能：全量 bug 排查 + 修复（已实现 ✅，已用无头浏览器验证）

**git 状态（2026-09-26）：** 分支 claude/dreamy-davinci-xtjt37，已 commit + push。

### 这次修了什么（13 项，版本号全量 bump 到 ?v=43）
- 联机 · 房主：远端 answer 只认被问的那个 peer，且值必须在选项里（坏值按跳过），
  不再能让主循环抛错卡死；掉线玩家标 p.gone，之后轮到他直接跳过（原来每步空等 120 秒）；
  超时后给对方发 cancel 收起过期面板，超时提示房主本地也可见；已入座的人重复 hello 时补发 welcome
- 联机 · 客人：room.onPeerJoin 定向补发 hello（原来 10 次广播≈15 秒后就放弃）；
  房主以第一个 welcome 为准，其余消息只认房主（防冒充房主注入 HTML）
- 大厅「加入」：房间号校验 / 联机模块就绪之后才离开当前房间（原来空号也会把房主踢成僵尸大厅）
- 大厅真人数超过所选人数自动上调时派发 change，compose.js 会按新人数重新校验阵容
- 单机：NAME 行真正生效（原来固定叫"你"）；预言家查验遮罩 await 完再放女巫遮罩（原来被同帧盖掉）
- entry.js：#setup 隐藏后不再接管方向键；女巫按钮名字不再二次转义；
  章节副标题 white-space: pre-line 恢复换行；net.js 锁 trystero@0.25（依赖其对象式 API）

### 验证方式
Playwright + 假 wwNet（模拟房主 / 客人 / 恶意 peer）逐项跑过；单机与「房主 + 2 远端」各完整打完一局，
零报错。**未做真机双设备联机**——CDN 在沙箱里被墙，Trystero 真连接没跑。

### 待办 / 下一步（按顺序）
1. [ ] 两台设备真联机一次：建房 → 输码加入 → 改名 / 准备 / 开局 / 中途关掉一方看是否自动跳过
2. [ ] 打开浏览器面板真人看一遍开局清单（笔触、抽屉、窄屏）
3. [ ] 「← 返回主菜单」「← 离开房间」两个 .entry-back 是否保留，等用户定

### 已知坑 / 注意
- #invitation 已经不带 .invitation 类了（改用 .entry-screen），style.css 里那套米色
  .invitation 变量因此彻底失效——这是有意的，别再把类加回去。
- game.js 写 #mpReadyBtn 文案必须走 setEntryLabel()，直接 textContent 会把行内结构抹平。
- .entry-part 会在两块屏幕之间移动，任何新代码都别缓存它们的 parentElement。
- 预览面板隐藏时 rAF 冻结 → 燃烧转场会卡在 busy、截图全黑，不是代码坏了。
- 客户端只处理房主（第一个 welcome 的 peer）的消息，新增消息类型要放进 fromHost 分支；
  远端回答都会过 pendingAsks 的 clean()，新询问的 opts.value 必须能 JSON 往返（数字 / 布尔 / null）。

## 已完成历史（摘要，勿删）
- ending screen 简化、title-screen hero art 右移加深（已 merge main + push）。
- 燃烧转场 + 邀请页暗夜改版。
- 开局清单改版。
- 全量 bug 排查修复 13 项（本次）。
- 更多历史见 git log。
