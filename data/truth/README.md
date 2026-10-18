# data/truth — 标注准则与真值清单

> 真值的**生成器**是 `tools/gen-samples.mjs`（`--check` 断定位级一致）；**校验门**是 `tools/check-truth.mjs`。
> 本文是人工可读的标注准则，也是规则域清单的**人类可读真源**——`check-truth.mjs` 逐行解析
> §3 的三张表，与它内置的清单对账；表里漏一条规则、或代码里多一条，都会直接报红。

## 1. 目录结构

```
data/samples/<域>/<文件>      样本（subtitle 文件；.srt / .vtt / .ass）
data/truth/<域>/<文件>.json   与样本**一一对应**的真值（同名、同目录结构）
data/truth/coverage.json      覆盖度矩阵（口径键 → 正例/反例样本），由生成器派生
```

一一对应是硬约束：**孤儿**（有样本无真值、或有真值无样本）由 `check-truth.mjs` 判红。

## 2. 真值纪律（plan/04 §三 的可执行条款）

1. **只存输入与期望**。真值里**禁止**出现 `observed` / `actual` / `message` 三个键（观测值由规则引擎运行时实算）。
   `expectFindings` 的每一项只允许 `ruleId`、`line`、`field` 三个键。
2. **期望值可由输入独立复算**。标注器是**独立实现**（`tools/samples/*oracle.mjs`），
   **不 import `src/core/**`**；阈值一律从 `data/ruleset.v1.json` 读，不在标注器里写第二份数值。
   M2/M3/M4/M5 的实现与标注因此构成**差分对照**，而不是"比对两份预先算好的答案"。
3. **单位**：定点整数「千分字符」（milli）：全角 = 1000，半角 = 500；空白、换行、标签、ASS 覆写块、SDH 标记不计入。
   `CPS = charsMilli / durationMs`（等价于 字符/秒）。
4. **行号口径（1-based）**：
   - `timing.*` 属**时间类** finding，`line` 取 `timeLine`（时间码所在行）；
   - `readability.*` / `hygiene.*` 属**文本类** finding，`line` 取 `sourceLine`（cue 块起始行）。
   （依据 plan/02 §3.1；readability/hygiene 的每条 cue 真值里同时给出 `timeLine` 供比对）
5. **行长上限的单位换算**：`line.maxWidthFull` / `line.maxWidthHalf` 的口径单位是"该档字符数"，
   折成千分字符后：中文/日文上限 = `line.maxWidthFull × 1000`，英文上限 = `line.maxWidthHalf × 500`。
6. **植入器自证**：每个域的"植入"都必须有**非空 diff**，并记录在真值里——
   - `format`：`plants[]`，把变体与该格式的**基准渲染**逐字节比较（23 处变异 diff 非空；
     ASS 的厘秒形态是原生基准，显式标 `mode: "baseline"` 而不是混进变异）；
   - `timing`：`planted[]`，每条样本都是"干净基线 8 条 cue + 一处植入"；
   - `hygiene`：`planted[]`，每条正例都给出干净基线文本，并断言基线不复现该规则；
   - `readability`：`planted[]`，每条正例都给出**干净孪生**（中和该规则的最小改动），
     断言孪生与原件 diff 非空、且孪生在独立判定式下不再报该规则。
   任一处的 diff 为空，该样本就不得计入检出率分母。
7. **内容白名单**：只用虚构剧名（`示例剧` / `Sample Show`）与占位角色名（`角色甲` / `Character A`）。
   生成器内置禁用词表（真实影视/角色/演员/字幕站），命中即抛错。
8. **样本与真值同提交**：改样本必须同改真值并重跑 `gen-samples --check`。
9. **块内空行口径（G13，M2 决定）**：SRT 的**块内空行 = 块终止符**——空行之后的行不再属于该块；
   若不构成合法块头，则显式报 `timing.unparsable-timecode`（**不得静默丢弃**）。
   本决定**不放宽**口径，故样本与真值无需改动；锚定于 `tests/parse_srt.test.mjs`。
   （`srt-v8-blank-noise` 只覆盖块间/首尾空行，不是块内空行。）

## 3. 规则域清单（人类可读真源）

### 3.1 时序（`timing.*`）

| ruleId | 编号 | 本轮状态 | 说明 |
|---|---|---|---|
| `timing.overlap` | T01 | 已实现 | `next.start < cur.end` |
| `timing.zero-duration` | T02 | 已实现 | `end == start` |
| `timing.negative-duration` | T03 | 已实现 | `end < start` |
| `timing.gap-too-small` | T04 | 已实现 | `0 <= gap < timing.gapMin` |
| `timing.non-monotonic` | T05 | 已实现 | 起点相对上一条倒退 |
| `timing.duplicate-cue` | T06 | 已实现 | 起止与文本完全相同 |
| `timing.negative-start` | T07 | 已实现 | 起点 < 0（样本用带符号时间码 `-HH:MM:SS,mmm`） |
| `timing.past-media-end` | T08 | 已实现 | 末 cue 结束超过声明媒体时长（未填则 `skipped`） |
| `timing.unparsable-timecode` | T09 | 已实现 | 时间码无法解析，走回退路径 |
| `timing.file-order-mismatch` | T10 | 已实现 | 文件顺序 ≠ 时间顺序（整段只报一条） |
| `timing.timecode-precision` | T12 | 已实现 | 亚毫秒 / 小时位 > 2 位 / 毫秒位 ≠ 3 位 |
| `timing.fps-drift` | T11 | **待 M3** | offset+scale 网格拟合残差超限；本轮进 `skipped[]` |

### 3.2 可读性（`readability.*`）

| ruleId | 编号 | 判定（定点） | 说明 |
|---|---|---|---|
| `readability.cps` | R01 | `charsMilli > cpsLimit × durationMs` | 档位由主导文字类别决定 |
| `readability.line-length` | R02 | `任一行 widthMilli > 该档行长上限` | 中/日 `line.maxWidthFull × 1000`；英 `line.maxWidthHalf × 500` |
| `readability.too-many-lines` | R03 | `可见行数 > line.maxLines` | |
| `readability.too-few-chars` | R04 | `charsMilli < line.minChars × 1000` | |
| `readability.duration-short` | R05 | `durationMs < duration.min` | |
| `readability.duration-long` | R06 | `durationMs > duration.max` | |
| `readability.repeated-text` | R07 | 相邻 cue 文本完全相同且时间不同 | 报在后一条 |

### 3.3 卫生（`hygiene.*`）

| ruleId | 编号 | 白名单（已知不报） |
|---|---|---|
| `hygiene.cjk-latin-spacing` | S01 | `iPhone` 一类整词（`hygiene.whitelist`） |
| `hygiene.punctuation-width` | S02 | `e.g.` / `i.e.` / `3.14` 一类 |
| `hygiene.trailing-punctuation` | S03 | 省略号、缩写；问号感叹号不属口径 |
| `hygiene.unclosed-tag` | S04 | 自闭合形态 `<i/>` |
| `hygiene.ass-override-residue` | S05 | 成对且不含反斜杠的 `{name}`（归 S06 处理） |
| `hygiene.placeholder-residue` | S06 | 单字母数学表达式 `{x}` |
| `hygiene.font-tag-residue` | S07 | — |
| `hygiene.sdh-marker` | S08 | 整条以 `♪` 起止的歌词语境 |
| `hygiene.all-caps` | S09 | `hygiene.whitelist` 内的专有名词 |
| `hygiene.repeated-punctuation` | S10 | — |

> S10 口径澄清：`data/ruleset.v1.json` 的 `hygiene.whitelist` **不包含** `...`，因此 `...` 计为连续同类标点（达到 `hygiene.repeatPunctMin` 即报）。

## 4. 样本清单

| 域 | 文件数 | 口径 | 真值 |
|---|---|---|---|
| `format` | 24 | 3 格式（srt/vtt/ass）× 8 变体（BOM / CRLF / 序号缺失 / 序号跳号 / 分隔符与时间码形态 / GBK / 行尾空白 / 空行噪声） | cue 边界 + 行号映射 + 解析诊断码 |
| `timing` | 13 | 12 类缺陷各 1 份 + 1 份干净基线 | `expectFindings`（ruleId + line + field） |
| `readability` | 4 | 200 条标注 cue（zh 60 / en 60 / ja 40 / 混排 40） | 逐条 `expectFindings` / `expectNoFindings` |
| `hygiene` | 1 | 30 条 golden set（10 正例 + 10 已知不报 + 10 边界） | 逐条 `expectFindings` / `expectNoFindings` |

格式变体的**等价替换**（plan/04 §一 表）：VTT 的「序号跳号」用 `NOTE` 块、「无 cue id」用缺省标识行、
「毫秒点号」用 `MM:SS.mmm` 短形态；ASS 的「序号缺失」用 `Format:` 字段乱序、「跳号」用 `Comment:` 行、
「厘秒」即 ASS 原生 `H:MM:SS.cc`。

**24 份格式样本（SRT/VTT/ASS 各 8 份）已被当前解析器 0 容差复现**：cue 边界、行号映射（`sourceLine` /
`timeLine` / `endLine` / `textLineNumbers`）与解析诊断码逐项相等（`tests/samples_generator.test.mjs`）。
M1 时 VTT/ASS 侧只是目标契约，M2 起已是实装。

## 5. 命令

```bash
node tools/gen-samples.mjs            # 写出全部样本与真值
node tools/gen-samples.mjs --check    # 逐字节一致 + 无孤儿（CI 用这条）
node tools/gen-samples.mjs --list     # 只打印将写出的文件
node tools/gen-samples.mjs --perf     # 10MB / 5000 cue 性能样本 → out/（不入仓）
node tools/check-truth.mjs            # 真值门：一一对应 / 禁字段 / 覆盖度 / 禁用词
```

## 6. 已知未验证项（不得写成已达成）

| 项 | 当前状态 | 何时可验 |
|---|---|---|
| VTT / ASS 真值 | ✅ 已达成（M2）：解析器已实装，16 份样本 0 容差 | 已验（M2） |
| `timing.fps-drift` 正例 | 样本已落库，规则未实现（M3） | M3 |
| 可读性 / 卫生真值 | 标注与独立判定式一致，规则未实现（M4/M5） | M4 / M5 |
| GBK 变体再生成 | 依赖宿主 `TextDecoder('gbk')`（Node 需含完整 ICU）；`--check` 会在缺 ICU 时报错而非静默 | 同左 |
| 10MB / 5000 cue 实测耗时 | 样本可生成，**耗时未测**（M5 基准回填） | M5 |
