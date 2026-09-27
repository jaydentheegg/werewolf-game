# PROGRESS.md · 当前进行状态（每次会话结束前更新，控制在半页内）

> 永久规则与项目地图看 CLAUDE.md。这里只写"现在改到哪、下一步做啥"。

## 当前功能：对局观感打磨（已实现 ✅，PR jaydentheegg/werewolf-game#5）

**git 状态（2026-09-27）：** 分支 claude/practical-cray-nxte8b，已 commit + push。版本号全量 bump 到 ?v=49。
按用户从 8 条建议里挑的顺序做了五轮（8 条建议已全部完成）：

1. 人物卡去画框：封面画廊去 gilded-frame；身份卡去 reliquary 画框 / 叶饰 / 描边 / 硬投影（.idcard-sigil 原被画框盖住，一并隐藏）；
   去掉 reliquary-frame.webp 的 preload（省约 340KB，素材文件保留）。
2. 建议 1/4/7：发言钟面整体下移 84px（发言人卡顶原被裁 54px、XII 压脸）；身份卡遮罩改纯黑；发言提示缩短。
   顺手删掉白天旧的 `.card` 内描边（优先级高过无框规则，在半透明出局卡上透出一圈框）。
3. 建议 2：界面文字 emoji → 原创符号（fx.js「九·二」）。game.js 字符串不动（进 G.events 给 AI、也广播给客人）；
   换成 <ww-glyph>，原 emoji 留在视觉隐藏的 <ww-glyph-src> → textContent 不变。必须用自定义标签（泛 `span` 选择器会套样式）。
   新增 sig-moon / sig-sun / sig-death。1x 屏下村民符号略像「0」（原有 sigil）。
4. 建议 5/6（midnight.css 末尾两段 v48）：
   - 昼夜光：对局里收掉 #fxCanvas（本来就被 #game 黑底挡住，只在 1420px 外露成两条灰带），#game 改透明；
     #game::before 冷月光 / ::after 圆桌暖光，position:fixed + z-index:-1（#game 是 .screen 自成层叠上下文），
     相位切换交叉淡入；卡面色调走 --card-tone（夜暗冷、昼回暖）。
   - 出局烧焦：灰烬色插画 + SVG 噪声位移做的焦黑毛边遮罩 + 焦痕 + 左上砖红蜡封（骷髅）替代「已离席」。
     .fx-die 动画：余烬橙光 → 毛边从卡外烧进（mask-size 136%→100%）→ 蜡封盖下；不碰 transform（圆桌 / 时钟靠它定位，
     旧 cardDie 会让卡跳位）。fx.js：夜里的死亡先挂起，等「天亮了」遮罩收起再播（原来总在遮罩下播完）；
     重绘换元素时用负 --die-at 接着播。手机上出局卡的标签收进卡内（否则被毛边遮罩切掉）。
5. 建议 3/8：
   - 座位镜头：暗身份座位原是同一把空椅子。fx.js 的 SEAT_FRAMES 按座位号给 .portrait-art 写 --seat-*（缩放 / 平移 /
     镜像 / 烛光位置），12 个镜头对准议事厅不同角落；写在元素自身 style 上，投票托盘复制 innerHTML 时一起带走。
     有立绘的座位只镜像 + 小幅平移。表里注明了覆盖约束（卡片宽高比 ≈ 0.69），改镜头时别让画面露边。
   - 图片瘦身：assets/web/ 放压缩副本，CSS 与 preload 全部改指向它（母版保留）。village JPEG 615KB → WebP q70 159KB；
     立绘 1MB → 348KB（alpha 只是每格边缘淡出，压在 #060607 上去掉 alpha，WebP q80）。两张 PSNR ≈ 35 dB。
     首屏图片合计 1.6MB → 510KB。Pillow 用 `pip install pillow` 装（沙箱里没有 cwebp / ImageMagick）。
- 验证：mock 整局到结算、可见文本无 emoji 泄漏、无 pageerror；file:// 正常；1920 / 1440 / 390 截图；
  出局动画逐帧截图，确认夜里死亡在天亮遮罩收起后才播；reduced-motion 下直接落到静态终态。
- 测试脚本注意：点 #action 按钮要给 ≥1.5s 超时（狼人选项有入场动画，300ms 会一直点不中、看起来像卡死）。

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
- 对局观感打磨：去画框 / 钟面 / emoji 符号化 / 昼夜光 / 出局烧焦 / 座位镜头 / 图片瘦身（本次）。
- 更多历史见 git log。
