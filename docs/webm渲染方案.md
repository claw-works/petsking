# WebM 透明视频渲染方案

> 用 VP9-alpha 透明视频作为桌宠素材载体的渲染方案。本文档随第一个 WebM 角色
> （残红）的生产过程逐步完善——每跑通一步就补一段实践记录。

---

## 为什么用 WebM

- **真透明视频**：VP9 + alpha（`ALPHA_MODE=1`）在浏览器 `<video>` 里直接透明合成，无需抠图代码。
- **表现力高**：美术即视频，AI 图生视频产出的任何画面都能直接用，不受骨骼/像素网格限制。
- **零逐帧代码**：动作的时序、缓动全在视频里，前端只负责「何时切到哪个视频」。

代价：素材体积比 GIF/精灵表大，且必须 VP9 或 AV1 编码（H.264 不支持 alpha）。

---

## 渲染器工作机制

实现见 `pet-lib/renderers/webm.js`。核心：

- **双 `<video>` 交叉淡入**：前台放当前动作，切动作时后台 video 先 `load` 好，`loadeddata`
  后把新视频 `opacity` 淡入（.18s）、旧视频淡出，避免黑屏/闪烁。
- **脚线对齐**：靠素材包 `pet.json` 的 `geometry.feetRatio` 把所有动作的脚底对齐到同一水平线，
  切动作时脚不跳。
- **朝向镜像**：`setFacing('right')` 用 CSS `scaleX(-1)` 水平翻转（左右不对称的角色会穿帮，需左右各出素材）。
- **循环控制**：`meta.loop`，非循环动作播完触发 `_onEnded` 回待机。

**表情特写弹层**（`pet.emote(action)`，见 §3.5 / §6）：
- 特写层是 stage 内一个 `.petlib-emote`（`width/height:100%`），**盖满本体区域**——播表情时
  隐藏本体（body video opacity→0），在同一位置放半身近景，看起来是「原位推近到脸部」。
- 播放时**暂停本体驱动**（避免概率链在特写期间切动作把本体显出来），播完恢复。
- **两端淡入淡出**：进场 .3s 淡入；结尾**前 0.35s 提前淡出**、本体同时淡回，交叉过渡更柔和。
- 素材从 `pack.emotes.actions[action]` 取（半身近景，独立于本体全身素材，不做脚线对齐）。

---

## 素材规格（对齐现有 blue-whale）

| 项 | 值 |
|----|----|
| 分辨率 | 640×360 |
| 画幅比例 | 16:9（`aspect: 1.7778`） |
| 帧率 | 24fps |
| 编码 | VP9 + alpha |
| 脚线 | 高度 91.67%（`feetRatio: 0.9167`） |

`pet.json` 的 `geometry` 直接复用：`{ "aspect": 1.7778, "feetRatio": 0.9167 }`，前端无需改代码。

> 素材的生产流程（截图取景、AI 提示词、绿幕抠像、ffmpeg 转码）见
> [WebM 宠物素材生产规范](webm宠物素材生产规范.md)。

---

## 首尾帧生成流程（可复用规范）

本节是「用首尾帧图生成动作视频」的标准流程，适用于所有 WebM 角色。核心思路：
**准备一组统一规格的静态姿势图 → 指定首帧/尾帧 → 视频 AI 补中间动作 → 绿幕抠像转码**。

### 0. 静态图规格（生成视频前先备齐）

所有静态图必须满足（否则动作衔接会跳、抠像会脏）：

| 项 | 要求 |
|----|------|
| 画幅 | **16:9**（与成品一致；角色水平居中，两侧留透明/绿幕余量） |
| 脚线 | 角色**脚底落在画面高度 91.67% 处**，所有图完全一致 |
| 机位 | 平视（相机高≈角色胸口），不俯不仰不斜，全套透视一致 |
| 服装配色 | 全套完全一致（图生视频最易漂移，基准图越统一越稳） |
| 背景 | 纯绿幕 `#00FF00`，角色身上不得有同绿色元素 |
| 光照 | 均匀正面光，无强阴影/背光 |

> **收尾帧 = 待机站姿（正面图）**：它既是 idle 的首帧，也是**几乎所有动作的尾帧**——
> 这样任何动作播完都能无缝接回待机。先把这张定死。

### 1. 静态图清单（残红：左右造型不对称）

残红左右腿造型不同（一侧有丝袜、一侧无），因此 **walk 左右各生成、绝不镜像**
（`scaleX(-1)` 会把丝袜镜到错误的腿上）。准备 5 张图：

| 编号 | 图 | 朝向 | 用途 |
|----|----|------|------|
| ① | 正面图 | 正面 | idle / drag / click 的基准帧（首=尾） |
| ② | 转左中间态 | 正面↔左侧之间 3/4 | turn-left 的过渡桥帧 |
| ③ | 左侧图 | 侧面朝左 | walk-left（露丝袜/无丝袜的那条腿朝外） |
| ④ | 转右中间态 | 正面↔右侧之间 3/4 | turn-right 的过渡桥帧 |
| ⑤ | 右侧图 | 侧面朝右 | walk-right |

### 2. 首尾帧配置表（每个动作用哪张图当首/尾）

「首帧」是视频第一帧、「尾帧」是最后一帧，视频 AI 在两者之间补动作。
**循环类**（idle/drag）首尾用同一张图保证无缝循环；**过场类**（walk/turn/click）尾帧回正面图以便接回待机。

| 动作 | 循环 | 首帧 | 尾帧 | 说明 |
|------|------|------|------|------|
| `idle` 待机 | 是 | ① 正面 | ① 正面 | 首尾同图，可无缝循环 |
| `drag` 拖拽 | 是 | ① 正面 | ① 正面 | 悬空姿势，首尾同图循环 |
| `click-*` 点击 | 否 | ① 正面 | ① 正面 | 短促反应后回正 |
| `walk-left` | 否 | ③ 左侧 | ③ 左侧 | 走路循环段，首尾同侧图（位移由前端加） |
| `walk-right` | 否 | ⑤ 右侧 | ⑤ 右侧 | 同上，朝右 |
| `turn-left` | 否 | ① 正面 | ③ 左侧 | 正面转到左侧，经中间态② |
| `turn-right` | 否 | ① 正面 | ⑤ 右侧 | 正面转到右侧，经中间态④ |

> walk 的首尾用同一张侧面图，是因为「迈腿」动作本身要能循环，且身体不做水平位移
> （位移交给前端 CSS，见素材生产规范 §6 的 leadSec/tailSec）。

### 2.5 时长建议（单条 ≤10s）

| 动作 | 时长 | 要点 |
|------|------|------|
| `idle` | 4~6s | 循环段，一个完整呼吸/眨眼周期，结尾回到首帧姿势才能无缝循环 |
| `drag` | 3~4s | 悬空晃荡循环，短一点节奏更自然 |
| `click-*` | 2~3s | 短促反应，反应完即回正 |
| `walk-left/right` | 4~5s | 结构：开头 0.5s 站 → 中间迈腿 → 结尾 0.5s 站（给前端 lead/tail 留静止段） |
| `turn-left/right` | 2~3s | 转身过渡，别拖沓 |

- **循环类（idle/drag）要凑整周期**：动作在时长内正好走完并回到首帧姿势，循环点才不跳。
- **短比长稳**：10s 是上限不是目标；短视频 AI 漂移少、循环更好接，别为凑时长放慢动作或加多余动作。

### 3. 提示词模板

**通用后缀 A（全身动作用，§3 的 ①~⑦ 每条都追加）：**

```
纯绿幕背景(#00FF00)，全身入镜，角色脚底始终在同一水平线不上下移动，
平视机位，光照均匀无强阴影，无UI无字幕水印，
角色外观/发型/服装/配色全程与首尾帧完全一致，动作自然流畅，
严格从首帧姿势过渡到尾帧姿势。
```

> 表情/情绪系列（§3.5）是半身近景，**不要用后缀 A**，改用 §3.5 里的**通用后缀 B**。

**① idle 待机（循环｜首帧=尾帧=正面图）**
```
角色正面站立，非常轻微的呼吸起伏、偶尔眨眼、发丝/衣摆微动，
重心与双脚完全不移动，动作细微缓慢、可无缝循环。[通用后缀]
```

**② drag 被拖拽（循环｜首帧=尾帧=正面图）**
```
角色像被无形的手从头顶拎起、双脚离地悬空，四肢自然下垂并轻微摆动晃荡，
表情略惊讶。可无缝循环。[通用后缀]
```

**③ click 点击回应（不循环｜首帧=尾帧=正面图）**
> 残红外冷内热、御姐风——点击反应从「傲娇/微惊」到「回归冷静站姿」，别做太夸张的蹦跳。
```
角色正面，被戳了一下的反应：先微微一怔或挑眉，随后一个克制而俏皮的小动作
（如轻甩头发 / 抱臂 / 轻挥手），动作短促(1~2秒)，结尾回到自然站立待机姿势。[通用后缀]
```
（多个 click 变体：把括号里的小动作换成 开心/害羞/傲娇/挥手 等不同情绪，尾帧都回正面图）

**④ walk-left 向左走（不循环｜首帧=尾帧=左侧图）**
```
角色侧面朝左，原地做行走动作：双腿交替迈步、手臂前后自然摆动，
身体保持画面居中不做水平位移（位移后期添加）。开头0.5秒与结尾0.5秒静止站立。
迈步循环流畅、可衔接。[通用后缀]
```

**⑤ walk-right 向右走（不循环｜首帧=尾帧=右侧图）**
```
角色侧面朝右，原地做行走动作：双腿交替迈步、手臂前后自然摆动，
身体保持画面居中不做水平位移。开头0.5秒与结尾0.5秒静止站立。
迈步循环流畅、可衔接。[通用后缀]
```

**⑥ turn-left 向左转向（不循环｜首帧=正面图，尾帧=左侧图）**
> 关键：转身要**靠脚步带动**，不是原地拧身子。真人转身会抬脚、换步、重心转移。
```
角色从正面转身到侧面朝左：先抬起一只脚向左侧踏出/碾转，重心随之转移，
另一只脚跟着调整步位，用脚步自然带动上半身一起转向，双臂随转身轻微摆动。
脚在原地附近踏步换向、不做整体水平位移。转身连贯有重量感，
结尾停在侧面朝左的自然站立姿势。[通用后缀]
```

**⑦ turn-right 向右转向（不循环｜首帧=正面图，尾帧=右侧图）**
```
角色从正面转身到侧面朝右：先抬起一只脚向右侧踏出/碾转，重心随之转移，
另一只脚跟着调整步位，用脚步自然带动上半身一起转向，双臂随转身轻微摆动。
脚在原地附近踏步换向、不做整体水平位移。转身连贯有重量感，
结尾停在侧面朝右的自然站立姿势。[通用后缀]
```

> **为什么之前不自然**：旧提示词写「脚步小幅调整、重心稳定」，AI 理解成脚几乎不动、
> 只旋转躯干，像被拧了一下。修正要点：明确「抬脚→踏出/碾转→重心转移→带动上身」，
> 把「不位移」限定为**不做整体水平移动**（脚可以原地踏步换向），而不是脚不动。

### 3.5 表情/情绪系列（半身近景，喂特写弹层）

这一组**不接在桌宠本体上**，而是通过前端的**表情特写弹层**（`pet.emote(action)`，见 §6）
在本体上方弹一个**半身近景**小窗播放，播完自动消失。原因：全身构图里脸只占一小块，
640×360 下五官糊成一团；情绪必须靠**半身近景 + 清晰表情**才看得清。

因为结构统一，用一个通用模板，每条只替换【情绪表演】那一段。

**取景要求（与全身素材不同，单独一套）：**
- **构图**：**半身近景**——胸部/腰部以上入镜，头顶留一点发饰空间，角色**正面、水平居中**。脸要够大、五官清晰。
- **不需要脚线**：特写弹层不做脚线对齐，画面里没有脚也没关系。
- **画幅**：仍 **16:9**（与弹层默认 `emotes.aspect: 1.7778` 一致）；分辨率 16:9 即可，转码统一到 640×360。
- **背景**：纯绿幕 `#00FF00`。
- **基准帧**：需**单独截一张半身近景定格**当首/尾帧（不是全身正面图①）。这张是这组表情的"原点"。

**通用模板（把【…】替换成下面表格里的情绪描写）：**
```
半身近景，角色正面出镜（胸部以上，脸部清晰、水平居中），身体基本不动。【情绪表演】
情绪**首先且主要通过面部表情**（眼神、眉、嘴）传达，头/肩/手的小幅动作只作点缀、不喧宾夺主，自然生动不夸张。
动作短促(2~3秒)，结尾回到平静的半身正面表情。[通用后缀 B]
```

> **踩坑记录**：emo-happy 初版写「嘴角上扬、眼神发亮，轻轻点头」，AI 把「点头」当成主动作，
> 光顾着点头、没笑出来。原因：表情和肢体动作**并列**时，AI 倾向做更具体的肢体动作。
> 修正：情绪描写里**把表情放最前、明确为主**，肢体动作降级为「配一点/点缀」，
> 并在替换句里直接写死表情（如「脸上绽开明显的微笑、眼睛弯起」）。

**通用后缀 B（半身近景专用，表情组每条都追加）：**
```
纯绿幕背景(#00FF00)，半身近景（胸部以上），角色水平居中、脸部清晰，
平视机位，光照均匀无强阴影，无UI无字幕水印，
角色外观/发型/服装/配色全程与首尾帧完全一致，动作自然流畅，
严格从首帧表情过渡到尾帧表情。
```

- **首帧 = 尾帧 = 半身近景基准图**（播完平滑淡出，不需要接回全身 idle）。
- **时长 2~3s**，非循环。
- 残红人设：**外冷内热、御姐风**——情绪要「克制中带真情」，避免幼齿化的大动作蹦跳。

**情绪替换表（【情绪表演】那一句）：**

| 动作名 | 情绪 | 【情绪表演】替换内容 |
|--------|------|----------------------|
| `emo-happy` | 开心 | 脸上绽开明显的微笑、嘴角上扬、眼睛弯起发亮，先笑起来再配一点轻微点头，笑意是主，动作是辅 |
| `emo-shy` | 害羞 | 视线短暂躲闪、脸微侧，抬手轻碰脸颊或拨一下发丝，带一丝不自然的可爱 |
| `emo-proud` | 傲娇/得意 | 微微扬起下巴、眼神睥睨，嘴角一抹自信的笑（近景可抱臂入镜） |
| `emo-angry` | 生气 | 皱眉鼓腮、眼神一沉，别过头，压着火气的傲娇怒 |
| `emo-surprised` | 惊讶 | 睁大眼、上身微微一顿后仰，抬手掩口，短促的一惊 |
| `emo-sad` | 失落 | 眉眼低垂、肩膀微塌，轻叹一口气、视线下移，情绪内收不哭闹 |
| `emo-think` | 思考 | 微偏头、一手托腮或指尖抵下巴，眼神上飘，若有所思 |
| `emo-wink` | 俏皮 | 一只眼俏皮眨眼，嘴角勾起，抬手比一个小手势，冷面下的一点调皮 |
| `emo-love` | 心动/喜爱 | 眼神柔和、双手轻叠胸前或比一个小心心，脸颊微红的温柔 |
| `emo-tired` | 困倦 | 半眯眼、轻打哈欠或揉眼，肩膀放松下垂，慵懒但不趴下 |

> 用法：从表里挑要做的情绪，把【情绪表演】整句替换进通用模板即可。命名统一用 `emo-<情绪>`。
> 接入：写进 pet.json 的 `emotes.actions`（不是 `actions`），`pet.emote('emo-happy')` 触发；
> 也可在 `intentMap` 里映射情绪意图到表情。

### 3.6 Agent 状态系列（状态机驱动，反映 AI 工作状态）

状态机驱动（`statemachine`）把 Agent 事件归一化成**语义状态**，按优先级折叠后经 `pet.json` 的
`stateActions` 映射到动作。优先级从高到低：
`WAITING_FOR_USER > ERROR > WORKING/CODING/RUNNING_COMMAND > THINKING > SUCCESS > STARTING > IDLE > SLEEPING`。

**这些是全身动作**（用后缀 A、首尾帧回正面站姿），不是半身表情。规划时**尽量复用已有素材**，
只有找不到合适复用的才新生成。

**状态 → 动作 规划表：**

| 语义状态 | 触发时机 | 建议动作 | 复用/新做 |
|----------|----------|----------|-----------|
| `STARTING` | 会话开始 | `click-wave`（元气挥手打招呼） | 新做（挥手，全身） |
| `IDLE` | 空闲 | `idle` | ✅ 已有 |
| `THINKING` | Agent 思考中 | `think`（托腮踱步/歪头思索） | 新做 |
| `WORKING` | 通用工具执行 | `work`（低头忙碌/操作） | 新做 |
| `CODING` | 编辑类工具 | `work`（可复用 WORKING） | 复用 work |
| `RUNNING_COMMAND` | 执行命令/终端 | `work`（可复用 WORKING） | 复用 work |
| `WAITING_FOR_USER` | 等用户输入/审批 | `turn-right`（回头张望等待） | ✅ 已有（暂用 turn） |
| `SUCCESS` | 任务完成 | `cheer`（欢呼/比耶） | 新做 |
| `ERROR` | 任务失败 | `error`（沮丧跺脚/抱头） | 新做 |
| `SLEEPING` | 长时间空闲 | `sleep`（原地小憩/打盹） | 新做 |

> **最小新做集**：`click-wave`(挥手) · `think`(思考) · `work`(忙碌) · `cheer`(欢呼) ·
> `error`(沮丧) · `sleep`(打盹)，共 6 条全身动作。WAITING_FOR_USER 先复用 turn-right，
> 有余力再单独做「回头等待」。

**提示词（全身，用通用后缀 A，首帧=尾帧=① 正面图；除 sleep 循环外均播完回正面）：**

**⑧ click-wave 打招呼（不循环）**
```
角色正面，元气满满地抬手向前挥手打招呼，面带微笑，身体轻微一晃，
动作短促(2~3秒)，结尾回到自然站立待机姿势。[通用后缀 A]
```
**⑨ think 思考（循环）**
```
角色正面，一手托腮/手指抵下巴，微偏头、眼神上飘做思索状，
重心在两脚间轻微交替、原地不平移，可无缝循环。[通用后缀 A]
```
**⑩ work 忙碌（循环）**
```
角色正面，专注地低头做操作的动作（双手在身前忙碌，如翻找/摆弄），
身体微前倾、原地不移动，可无缝循环。[通用后缀 A]
```
**⑪ cheer 欢呼（不循环）**
```
角色正面，任务达成的开心欢呼：双手轻举/比耶，轻轻跳一下或踮脚，
表情雀跃但不失御姐的克制，动作(2~3秒)，结尾回到自然站立待机姿势。[通用后缀 A]
```
**⑫ error 沮丧（不循环）**
```
角色正面，遇到错误的懊恼反应：皱眉、垂头或双手一摊/扶额，轻轻跺一下脚，
动作(2~3秒)，结尾回到自然站立待机姿势。[通用后缀 A]
```
**⑬ sleep 打盹（循环）**
```
角色正面，原地站着打盹小憩：双眼微闭、头缓缓一点一点，呼吸起伏，
偶尔头轻晃回正，重心不移动，动作缓慢、可无缝循环。[通用后缀 A]
```

**接入**：写进 `pet.json` 的 `actions` 和 `stateActions`（状态→动作名）。例：
```jsonc
"actions": { ..., "click-wave":"click-wave.webm", "think":"think.webm",
             "work":"work.webm", "cheer":"cheer.webm", "error":"error.webm", "sleep":"sleep.webm" },
"stateActions": {
  "STARTING":"click-wave", "IDLE":"idle", "THINKING":"think",
  "WORKING":"work", "CODING":"work", "RUNNING_COMMAND":"work",
  "WAITING_FOR_USER":"turn-right", "SUCCESS":"cheer", "ERROR":"error", "SLEEPING":"sleep"
}
```
> 测试：playground 切 statemachine 驱动（或点 Agent 事件按钮会自动切），点 start/thinking/
> tool·edit/完成/失败 等按钮，看是否映射到对应动作。

### 4. 生成时的通用要点

- **首帧/尾帧都要指定**：多数视频 AI（可灵/即梦/Runway/Pika 等）支持首尾帧。首帧尾帧都传对应静态图，效果最稳。
- **时长设短**：2~5s。越短越稳、越省抠像功夫；idle/drag 循环段 3~6s。
- **反复强调一致性**：同角色/发型/服装/配色。这是图生视频最容易漂移的地方。
- **强调脚底同一水平线、身体不位移**：位移交给前端。
- **左右不镜像**：残红左右腿造型不同，walk-left / walk-right 必须各自生成。
- 生成后**先只做 ① idle 一条**，走完抠像转码接入前端验证管线，再批量做其余。

### 5. 生成 → 转码 → 接入

1. 视频 AI 产出 `mp4`（绿幕）。
2. 按素材生产规范 §8 的 ffmpeg 命令抠像转码为 640×360 VP9+alpha webm。
3. 用 `ffprobe` 验收：`640×360 / 24fps / VP9 / ALPHA_MODE=1`。
4. 文件放入 `assets/`（或角色专属素材目录），在 `pets/canhong/pet.json` 的 `actions` 里登记。
5. 浏览器叠花色背景验证：无绿边、循环无跳变、脚线不飘、切动作脚不跳。

---

## 6. 前端能力（本项目为 WebM 桌宠加的交互）

### 对象式 action（参数化 / 素材复用）

`pet.json` 的 `actions[名]` 可以是**字符串**（文件名，整段循环，向后兼容）或**对象**：
```jsonc
"actions": {
  "idle": "idle.webm",                                   // 字符串 = 整段
  "think": { "file": "think.webm", "from": 0, "to": -1, "loop": true },
  "nod":   { "file": "think.webm", "from": 34, "to": 52, "loop": true },  // 复用 think 文件、只截一段
  "walk-l":{ "file": "walk.webm", "flipX": true }        // 对称角色：镜像出反方向，省素材
}
```
参数（帧为单位，按 `pet.json` 顶层 `fps`（默认 24）换算成秒）：

| 参数 | 说明 |
|------|------|
| `file` | 素材文件。**多个 action 可指同一文件 = 复用素材** |
| `from` | 播放起始帧（默认 0）。from/to 是「播放硬边界」 |
| `to` | 播放结束帧；不填或 `-1` = 视频末尾 |
| `loop` | 是否循环（默认跟随驱动）|
| `loopFrom` | 循环回跳帧（默认 = from）。首播含 [from, loopFrom] 的入场/前摇 |
| `loopTo` | 循环终点帧（默认 = to）。循环阶段在 [loopFrom, loopTo] 反复，到点回跳 loopFrom |
| `exit` | true 时被切走前先播完 [当前, to] 收尾段再切（默认硬切）|
| `speed` | 播放速度（1 正常 / 0.5 慢放 / 2 快放） |
| `flipX` | 左右镜像（与 `facing='right'` 异或叠加）——**解决"向左/向右走"可复用一个素材** |
| `flipY` | 上下镜像（预留） |

> **扩展不写死**：新增参数只需在 `pet-lib/renderers/webm.js` 的 `play()` 里加一处处理。
> **入场+后段循环**：`{file, loop:true, from:N}` 会从第 N 帧循环——但注意首播也从 N 开始（不含 0~N 入场）；
> 若需"入场播一次、之后循环后段"，当前用截取无法表达（需单独入场素材或后续扩展）。


- **表情特写弹层** `pet.emote(action)`：在本体位置盖满播半身近景表情，隐本体、暂停驱动、
  两端淡入淡出，播完淡回本体。素材取 `pack.emotes.actions`。用于「原位推近看表情」。
- **拖拽播 drag**：拖动开始暂停驱动 + 循环播 `drag` 动作，松手恢复（需素材包有 `drag`）。
- **走动位移**：播 walk 动作时前端同步平移整个宠物容器（真实位移，视频本身是原地迈腿）。
  配 `pet.json` 的 `walk:{ left, right, speed(px/s), margin }`——`left/right` 指定左右走动作名，
  播到对应动作就朝对应方向移动，`speed` 控制速度，到视口边缘（留 `margin`）停下；
  切非 walk 动作或拖拽时停止位移。
- **意图/情绪表演** `pet.react(intent)`：经 `intentMap` 映射；若映射到表情特写则走 `emote()` 弹层，
  否则本体播放。可配合 `pet.say(text)` 冒泡台词。
- **概率链** `chain`：动作时长默认 8~20s 随机；`stop()`/`start()` 可暂停/恢复（拖拽、特写、
  手动预览期间会暂停，空闲后恢复）。
- **状态机** `statemachine`：喂 Agent 事件 → 语义状态 → `stateActions` → 动作（见 §3.6）。
  **IDLE 时自动委托概率链**：若素材包有 `chain` 池配置，状态机在 IDLE（无 Agent 事件）时
  会跑概率链的自主陪伴（走动/转身/思考/打盹），一旦来事件立即切到对应工作状态。
  即「有任务→反映工作状态，没任务→自主陪伴」。此时不再自动转 SLEEPING（打盹已在 chain 的 idle 池里）。

> **开发提醒**：改动 `pet-lib/*.js` 或 `pet.json` 后，浏览器会缓存旧模块，普通刷新看不到更新，
> 需**硬刷新（Cmd+Shift+R）**。验证时可用 `import('...js?bust=时间戳')` 强制拉最新。

---

## 生产记录（边做边补）

<!-- 每完成一个角色/动作，在这里追加实践记录：踩过的坑、调好的 ffmpeg 参数、提示词模板等 -->

### 残红（canhong）

**素材目录**：`pets/canhong/assets/`（角色专属，不复用共享库）

#### idle（✅ 已跑通，管线已验证）

- **AI 产出**：`idle-green.mp4`，H.264，**864×480**（16:9）、24fps、6.58s，纯绿幕 `#00FF00`。
- **实测脚线**：抽首/中/尾帧测得角色脚底在 **96.25% / 96.46% / 96.88%**（平均 ≈96.5%），
  水平中心 50.7%（近乎完美居中），头顶留白 5~5.8%。首尾姿势一致，循环平滑。
- **geometry 配置**：`{ "aspect": 1.7778, "feetRatio": 0.965 }` —— 残红脚线比 blue-whale（0.9167）低，
  角色更贴底，这是**残红自己的脚线值**，按实测填。
- **转码命令**（chromakey 比 colorkey 抠得更干净，加 despill 去绿边）：
  ```sh
  ffmpeg -y -i idle-green.mp4 -vf "\
  chromakey=0x00FF00:0.12:0.06,\
  despill=type=green:mix=0.5:expand=0.3,\
  format=yuva420p,\
  scale=640:360:force_original_aspect_ratio=decrease,\
  pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x00000000\
  " -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 28 -an idle.webm
  ```
- **成品**：`idle.webm`，640×360 / VP9 / 24fps / `ALPHA_MODE=1`，328KB。透明合成无绿边（发丝边缘自然羽化）。
- **接入**：`pets/canhong/pet.json` 已建（geometry 按 0.965），注册进 `pets/index.json`，
  playground 加载 `canhong / webm / chain` 循环播放 idle 正常。

**经验小结**：
- AI 产出分辨率不必是 640×360，**16:9 即可**，转码时 `scale` 统一缩下来。
- `chromakey`（YUV 空间）比 `colorkey`（RGB）抠绿更干净；`despill` 去绿边效果好。
- **脚线值以实测为准**，不必强凑 91.67%——只要全套素材脚线一致，`feetRatio` 照测照填。
- 验收三件套：`ffprobe` 看 `ALPHA_MODE=1` + 叠纯色底看无绿边 + playground 看循环脚线。

#### drag（✅ 已跑通 + 修复库缺陷）

- **AI 产出**：`drag-green.mp4`，规格同 idle（864×480 / 24fps / 6.58s / 纯绿幕）。
- **转码**：同 idle 命令，产出 `drag.webm`（640×360 / VP9 / ALPHA_MODE=1 / 467KB）。首尾姿势一致，悬空晃荡可循环。
- **接入**：登记进 `pet.json` 的 `actions.drag`。drag 不进 chain 概率池——它由拖拽交互触发。
- **⚠️ 修复了库的一个历史缺陷**：`pet-lib/pet.js` 的 `_bindDrag` 原本拖拽时只 `setPosition` 挪位置、
  松手只 `_emit('drag')`，**从不调用 `play('drag')`**——所以 chain 驱动下拖拽动画永远是 idle（blue-whale 同样中招）。
  已加 `_startDragAnim/_endDragAnim`：拖动开始时暂停驱动并循环播 drag，松手恢复驱动回 idle
  （仅当素材包有 drag 动作时触发，不影响无 drag 的包）。
- **连带修复** `pet-lib/core/chain-driver.js`：`stop()` 置 `paused=true` 后，原 `start()` 未重置，
  导致拖拽后恢复会卡在 idle 不再掷骰。已让 `start()` 先 `paused=false`。
- **验证坑**：浏览器 ES 模块缓存会让 `pet.js` 改动不生效（`index.js` 静态 import 无版本号，整个会话不重拉）。
  开发时改完库代码要**硬刷新（Cmd+Shift+R）或新开标签页**才看得到；用 `import('...pet.js?bust=时间戳')` 可强制验证。

#### click-happy（✅ 已跑通）

- **AI 产出**：`click-green.mp4`，864×480 / 24fps / **3.04s**（点击回应宜短）/ 纯绿幕。
- **转码**：同上命令，产出 `click-happy.webm`（640×360 / VP9 / ALPHA_MODE=1 / 285KB）。
- **接入**：登记进 `actions["click-happy"]`、加入 `chain.clicks` 池（点击随机抽）、`intentMap.happy`。
- **验证**：点击 → 播 click-happy → 3.2s 后自动回 idle（非循环动作播完接回待机），正常。

#### walk-left / walk-right（✅ 已跑通，含裁剪 + 顺拐修正）

- **AI 产出**：各 864×480 / 24fps / ~5.17s / 纯绿幕。**左右分别生成、绝不镜像**（残红丝袜腿不对称）。
- **裁首尾静止段**：原视频首尾各带约 0.3~0.5s 站立段，循环时「走两步顿一下」。用逐帧差异分析定位
  静止段裁掉。walk-left 保留帧 8–114（4.46s）。
- **顺拐修正（关键经验）**：walk-right 起点若用「直立站姿」帧，循环回首帧时会从「迈步中」猛跳回
  「直立」→ 顺拐。**修正：循环起点选在「行走中的姿态」帧**（残红 walk-right 用帧 14–93），
  首尾都是迈步状态才接得顺。像素缝隙指标测不出「哪只脚在前」的相位错位，需肉眼判断。
- **接入**：`actions.walk-left/right` + `chain.actions`。walk-right 未镜像（`transform` 为空）。

#### turn-left / turn-right（✅ 已跑通）

- **AI 产出**：各 864×480 / ~1.63s / 纯绿幕。裁尾部 3 帧冗余静止，产出 ~1.5s webm。
- **提示词修正**：初版「脚步小幅调整不位移」被 AI 理解成原地拧躯干、不自然。改成
  「抬脚→踏出/碾转→重心转移→带动上身」，「不位移」限定为不做整体水平移动（脚可原地换向）。
- **接入**：`actions.turn-left/right`；turn-right 接 `stateActions.WAITING_FOR_USER`。

#### 表情特写 10 个（✅ 已批量跑通）

- happy / shy / proud / angry / surprised / sad / think / love / tired / wink。
- **半身近景**（§3.5），864×480 / 2.3~3s / 纯绿幕，同一 chromakey 命令批量转码为 640×360 VP9+alpha。
- **接入**：全部写进 `emotes.actions`（不是 `actions`）；9 个情绪映射进 `intentMap`。
- **intent→emote 路由修复**：`agent-bridge.js` 的 `reactTo` 原来只 `pet.play()`（本体），
  表情文件不在 `actions` 里会失败。已改为：意图映射到表情（在 `emotes.actions` 里）时走 `pet.emote()` 弹层。

#### 前端能力 & playground（本轮新增）

- **表情特写弹层**：`pet.emote()` 盖满本体、原位推近半身近景、两端淡入淡出、暂停本体驱动（见 §6）。
- **拖拽播 drag**：修复库缺陷（见上 drag 节）。
- **序列衔接测试**：playground 可按 `turn-right, walk-right, idle` 顺序连播，测转身→走路衔接。
- **概率链时长**：默认 playMs 从 2600 → **8000~20000ms 随机**（`chain-driver.js`）。
- **playground 交互**：点动作/表情/意图/点击 → 暂停概率链（`manualHold`）；空闲 15s 自动恢复；
  点 Agent 事件按钮自动切 statemachine；意图表演附带 `pet.say()` 冒泡台词（残红人设）。
- **默认预览尺寸**：playground size 默认 520px（大图）。

#### Agent 状态系列 6 个（✅ 已跑通）

- click-wave / think / work / cheer / error / sleep，全身，864×480 / ~3s / 纯绿幕，同命令批量转码。
- **接入**：`actions` + `stateActions`（STARTING→click-wave, THINKING→think,
  WORKING/CODING/RUNNING_COMMAND→work, SUCCESS→cheer, ERROR→error, SLEEPING→sleep,
  WAITING_FOR_USER→turn-right 复用）。
- **验证**：statemachine 驱动喂 session.started/agent.thinking/tool.started(edit,bash)/
  user_input.required/task.completed/task.failed，全部正确映射到对应动作。

#### 待生产
残红核心动作集已完成（全身 13 + 表情 10）。后续按需扩：更多点击变体 / 节日动作 / think 循环区间优化等。


### 早雾（zaowu）

**素材目录**：`pets/zaowu/assets/`（角色专属）。竖幅角色，`geometry: { "aspect": 0.7692, "feetRatio": 0.92 }`（640×832）。

#### idle（✅ 已跑通）

- **AI 产出**：`idle-green.webm`，AV1、**640×832**（竖版）、24fps、3.04s，纯绿幕 `#00FF00`（ComfyUI + MiniMax H3 图生视频，首尾帧同用正面站姿图）。
- **转码命令**（与 canhong 相同的 chromakey+despill 管线，`scale/pad` 改为竖幅 640×832）：
  ```sh
  ffmpeg -y -i idle-green.webm -vf "\
  chromakey=0x00FF00:0.12:0.06,\
  despill=type=green:mix=0.5:expand=0.3,\
  format=yuva420p,\
  scale=640:832:force_original_aspect_ratio=decrease,\
  pad=640:832:(ow-iw)/2:(oh-ih)/2:color=0x00000000\
  " -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 28 -an idle.webm
  ```
- **验收**：`ffprobe` 确认 `ALPHA_MODE=1`；抽首/中/尾帧叠纯色底检查，抠像干净无绿边，首尾姿势一致（轻微晃动+眨眼），脚线与已有 `feetRatio: 0.92` 吻合，未调整 geometry。
- **成品**：`idle.webm`，640×832 / VP9 / 24fps / `ALPHA_MODE=1`、417KB。
- **接入**：`pets/zaowu/pet.json` 登记 `actions.idle`，加入 `chain.idle` 池，`stateActions.IDLE` 映射到 idle（此前只有 `work` 动作、无待机态）。

#### dance1 / dance2 / click-wave(greet) / sleep（✅ 已跑通）

- **AI 产出**：`green-dance1.mp4` / `green-dance2.mp4` / `green-greet.mp4`（各 640×832 / H.264 / 24fps / 4.46s）、
  `green-sleep.mp4`（640×832 / H.264 / 24fps / 3.04s），均纯绿幕。另有 `green-work.mp4` 与已接入的 `work.webm`
  转码结果一致（同源重复素材，未重复登记）。
- **转码**：与 idle 相同的 chromakey+despill 命令（`scale/pad` 640×832），批量产出
  `dance1.webm`（1.85MB）/ `dance2.webm`（1.56MB）/ `greet.webm`（1.04MB）/ `sleep.webm`（503KB）。
- **验收**：抽首/中/尾帧叠纯色底检查，四条均无绿边残留；`greet` 是清晰的挥手打招呼动作（睁眼→闭眼笑挥手→回正面站姿）；
  `sleep` 是闭眼低头打盹姿态；`dance1/dance2` 首尾回正面站姿。
- **接入**：`pets/zaowu/pet.json` ——
  - `actions`: 新增 `dance1`、`dance2`、`click-wave`（复用 greet 素材命名为打招呼动作）、`sleep`。
  - `chain.idle`: `["idle", "sleep"]`（打盹纳入待机池）；`chain.actions`: `["dance1", "dance2"]`（随机动作池）。
  - `stateActions`: 新增 `STARTING → click-wave`、`SLEEPING → sleep`。

#### walk-left（✅ 已跑通，含前摇/尾部裁剪）

- **AI 产出**：`green-walk-left.mp4`，640×832 / H.264 / 24fps / 4.46s（107 帧），纯绿幕。
- **转码**：同 idle 命令，产出 `walk-left.webm`（640×832 / VP9 / ALPHA_MODE=1 / 1.77MB）。
- **帧结构分析**（逐帧差异 + 肉眼核对）：
  - 帧 0–2：正面站立（前摇前的静止段）。
  - 帧 3 起：瞬间转身到侧面朝左并开始迈步，前摇极短。
  - 帧 ~10–89：稳定的侧面行走循环段，步态周期约 9 帧。
  - 帧 ~90–106：逐渐收步站定，尾部静止段（不能进循环，否则循环时会「走两步顿一下」）。
- **循环区间选取（顺拐修正）**：没有直接裁剪素材，改用 §6 的对象式 action 参数表达播放范围：
  `loopFrom: 10` / `loopTo: 89`——两帧都取「右腿前伸、左腿后蹬」同一步态相位，姿态高度接近，
  循环回跳不跳变。**未选帧 0 或站定的尾帧作循环起止**，避免顺拐（参照残红 walk 的经验：
  循环起点要落在行走中的姿态，不能是直立站姿）。
- **接入**：`pet.json` 的 `actions.walk-left` 用对象式配置
  `{ "file": "walk-left.webm", "loop": true, "loopFrom": 10, "loopTo": 89 }`；
  首播会先播 [0, 10) 的转身前摇，再进入 [10, 89] 循环行走，退出时停在循环段内（硬切）。
  加入 `chain.actions` 随机动作池。

#### walk-right（✅ 已跑通，含前摇/尾部裁剪；与 walk-left 各自独立生成）

- **AI 产出**：`green-walk-right.mp4`，规格同 walk-left（640×832 / H.264 / 24fps / 4.46s / 107 帧），纯绿幕。
  **未镜像 walk-left**——两条素材独立生成（早雾未确认是否左右不对称，按残红的保守经验各自出素材）。
- **转码**：同一 chromakey+despill 命令，产出 `walk-right.webm`（640×832 / VP9 / ALPHA_MODE=1 / 1.65MB）。
- **帧结构分析**：前摇比 walk-left 更长——帧 0–14 正面站立（含眨眼等待机细节），帧 15 起瞬间转身侧面朝右
  并开始迈步；帧 ~90–106 逐渐收步站定，尾部静止段需排除在循环外。
- **循环区间选取**：帧 25 与帧 81 相位高度一致（右腿后蹬伸展、左腿前迈），间隔约 3.7 个步态周期
  （单周期约 15 帧），比相邻帧匹配覆盖更多行走距离且姿态误差更小。
  `loopFrom: 25` / `loopTo: 81`，跳过帧 0–24 的前摇转身和帧 82–106 的尾部收步静止段。
- **接入**：`actions.walk-right` 对象式配置 `{ "file": "walk-right.webm", "loop": true, "loopFrom": 25, "loopTo": 81 }`；
  加入 `chain.actions`。左右素材齐备后，`pet.json` 顶层新增 `walk: { "left": "walk-left", "right": "walk-right",
  "speed": 55, "margin": 20 }`，接入前端走动位移能力（播 walk 动作时容器同步平移，视频本身原地迈腿）。

#### drag / click-happy（✅ 已跑通）

- **AI 产出**：`green-drag.mp4`（640×832 / H.264 / 24fps / 3.04s）、`green-click.mp4`（同规格），纯绿幕。
- **转码**：同一 chromakey+despill 命令，产出 `drag.webm`（640×832 / VP9 / ALPHA_MODE=1 / 1.10MB）、
  `click.webm`（207KB）。
- **验收**：抽首/中/尾帧叠色底检查——`drag` 中段是闭眼双臂上举、双脚离地悬空晃荡（符合 §3 drag 提示词
  模板「像被无形的手从头顶拎起」），首尾回正面站姿，可循环；`click` 中段是短促的张嘴微惊反应，首尾一致。
  两条均无绿边残留。
- **接入**：`pet.json` ——
  - `actions.drag`：不进 `chain` 概率池，由拖拽交互触发（同残红的约定：drag 由 `pet-lib` 的
    `_bindDrag` 在拖动开始时播放、松手恢复驱动）。
  - `actions.click-happy`：命名沿用项目里点击动作的命名习惯，加入 `chain.clicks` 点击随机池。

#### happy（✅ 已跑通，独立于 click-happy）

- **AI 产出**：`green-happy.mp4`（640×832 / H.264 / 24fps / 3.04s），纯绿幕，全身构图（不是 §3.5 的半身近景表情）。
- **转码**：同一 chromakey+despill 命令，产出 `happy.webm`（640×832 / VP9 / ALPHA_MODE=1 / 617KB）。
- **验收**：首尾正面站立，中段闭眼张嘴开心大笑，无绿边残留。
- **接入**：`actions.happy`，命名与已有 `click-happy`（点击回应，短促反应）区分——这条是更强烈的
  全身欢笑表演，不由点击触发，加入 `chain.actions` 随机动作池。

#### angry / shy（✅ 已跑通；均为全身动作，不是半身表情特写）

- **AI 产出**：`green-emo-angry.mp4`、`green-emo-shy.mp4`（均 640×832 / H.264 / 24fps / 3.04s），纯绿幕，**全身构图**。
- **命名说明**：素材文件名带 `emo-` 前缀，但内容都是全身反应动作，不是 §3.5 规定的半身近景表情。
  `pet.json` 动作名去掉 `emo-` 前缀改用 `angry`/`shy`，避免与后续真正走 `emotes.actions` +
  `pet.emote()` 弹层的半身表情素材混淆命名语义；素材文件仍保留原名 `emo-angry.webm`/`emo-shy.webm`
  （文件名本身无所谓，重要的是 `pet.json` 里的动作名和挂载位置对不对）。
- **转码**：同一 chromakey+despill 命令，产出 `emo-angry.webm`（496KB）、`emo-shy.webm`（617KB），
  均 640×832 / VP9 / ALPHA_MODE=1。
- **验收**：两条首尾均为正面站立，中段分别是皱眉生气 / 双手交叠身前害羞的反应，无绿边残留。
- **接入**：`actions.angry` + `actions.shy`，均加入 `chain.actions` 随机动作池。

#### beg / wink（✅ 已跑通；均为全身动作）

- **AI 产出**：`green-beg.mp4`、`green-wink.mp4`（均 640×832 / H.264 / 24fps / 3.04s），纯绿幕，**全身构图**。
- **转码**：同一 chromakey+despill 命令，产出 `beg.webm`（483KB）、`wink.webm`（466KB），
  均 640×832 / VP9 / ALPHA_MODE=1。
- **验收**：首尾均正面站立；`beg` 中段是双手合十、闭眼张嘴的祈求反应；`wink` 中段是眨眼比小手势——
  虽然叫「表情」，但取景仍是全身，跟 angry/shy 一样不走 §3.5 的半身近景弹层，直接进 `actions`。
  两条均无绿边残留。
- **接入**：
  - `actions.beg`：**只**接进 `stateActions.WAITING_FOR_USER`（此前早雾缺这个状态映射），
    不进 `chain.actions`——语义上是「等待审批」的专属反应，不适合随机播放。
  - `actions.wink`：加入 `chain.actions` 随机动作池，跟其余情绪动作一致。

#### think / cheer（✅ 已跑通）

- **AI 产出**：`green-think.mp4`（640×832 / H.264 / 24fps / 3.04s，纯绿幕，中段托腮思索反应）、
  `green-cheer.mp4`（同规格，中段双手举拳+比V手势的开心欢呼），均全身构图。
- **转码**：同一 chromakey+despill 命令，产出 `think.webm`（929KB）、`cheer.webm`（895KB），
  均 640×832 / VP9 / ALPHA_MODE=1。
- **验收**：首尾均正面站立，无绿边残留。
- **接入**：
  - `actions.think`：整段循环（`loop:true`，未截取 loopFrom/loopTo），映射到 `stateActions.THINKING`。
  - `actions.cheer`：不循环（`loop:false`，播完自然回到 IDLE），映射到 `stateActions.SUCCESS`
    （此前早雾缺这个状态映射）。
  - 均不进 `chain.actions`——跟 `beg` 一样是专属状态反应，不适合随机陪伴时播放。

#### 待生产
早雾核心动作集：idle / work / dance1 / dance2 / click-wave / sleep / walk-left / walk-right / drag /
click-happy / happy / angry / shy / beg / wink / error / surprised / sad / think / cheer，共 20 条全身动作，
`stateActions` 已覆盖 STARTING/IDLE/THINKING/WORKING/CODING/RUNNING_COMMAND/WAITING_FOR_USER/SUCCESS/ERROR/SLEEPING
（§3.6 状态机规划表全部落地）。真正的半身近景表情特写（走 emotes.actions）、turn 仍待后续按残红的规范补齐。
