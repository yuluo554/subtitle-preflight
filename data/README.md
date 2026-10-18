# data — 依据查证、数据计划与数值口径

**基准日**：2026-10-17。
**GitHub 检索实测窗口**：2026-10-18 10:33–10:45 UTC（与基准日**跨日不足 1 天**；星数与 `total_count` 均为该窗口快照，复跑请先记录当次时间）。
**三态语义**：✅ 已核对（可直连 / 快照已存 / 可复现）；⬜ 未验证或软论据（登记路径与阻断原因，**不得写成承诺**）。

---

## 1. 依据查证记录

### 1.1 需求证据（原话，✅ 已核对）

| 编号 | 原话（节选） | 出处 | 状态 |
|---|---|---|---|
| D1 | "this only works with offsets and doesn't adjust the subtitle's playback speed… usually caused by playing a subtitle written for a given FPS played back on a different FPS" | HN 583 分 · `https://news.ycombinator.com/item?id=19248723` | ✅ |
| D2 | "The whole subtitling world is very, very messy… You might have a file that works in one place, but when you upload it somewhere else, it doesn't work." | HN · `https://news.ycombinator.com/item?id=30219276` | ✅ |
| D3 | "Wish it supported ASS file formatting better though." | 同上 | ✅ |
| D4 | "not enough people complain about the quality" | HN · `https://news.ycombinator.com/item?id=41501570` | ✅ |
| D5 | "细看下来其实译文的意思也没有错…可能只是因为**字幕断句断的不好**" | V2EX · `https://www.v2ex.com/t/1209859` | ✅ |
| D6 | "用剪映生成的带时间线的 srt 字幕文件**不够理想**" | V2EX · `https://www.v2ex.com/t/1029923` | ✅ |
| D7 | "衣柜的字幕质量超赞只可惜跟我的版本不符…subsync **只能改 srt**，ass 的就无能为力了" | V2EX · `https://www.v2ex.com/t/282431` | ✅ |
| D8 | "追剧字幕时间轴不同步，造了个自动校正时间轴的轮子" | V2EX · `https://www.v2ex.com/t/857400` | ✅ |
| D9 | "时间轴**很混乱**，没法正常用" | V2EX · `https://www.v2ex.com/t/1232325` | ✅ |

> 引用纪律：以上均为**原话节选**，只用于证明"投放前体检"的需求真实存在；不用于推导任何数值阈值。

### 1.2 开源检索快照（⬜ 软论据；`gh api search/repositories`，窗口见页首）

| 检索式（`in:name,description`） | `total_count` | 头部项目 | 状态 |
|---|---|---|---|
| `subtitle qc` | 32 | 1★ bilingual-subtitle-workflow；0★ liruilong-coder/drama-subtitle-qc | ✅ 快照 |
| `subtitle lint` | 8 | 59★ linto-ai/linto-studio（语音转写平台，非 lint）；4★ cli-subtitle-linter | ✅ 快照 |
| `srt lint` | 8 | 3★ × 3 | ✅ 快照 |
| `subtitle checker` | 43 | 8★ yt-caption-checker | ✅ 快照 |
| `subtitle validator` | 58 | 112★ SRT-Subtitle-Translator-Validator（翻译 App，校验附属） | ✅ 快照 |
| `cps subtitle` | 6 | 1★ | ✅ 快照 |
| `subtitle readability` | 52 | 19★ renpy-bilingual-builder（引擎侧） | ✅ 快照 |
| `subtitle compliance` | 4 | 1★ | ✅ 快照 |
| `subtitle checker language:HTML` | 2 | 0★ | ✅ 快照 |
| `srt viewer language:HTML` | 5 | 1★ | ✅ 快照 |

**头部在位者（非单文件）**：`SubtitleEdit/subtitleedit` **14603★**（C# 桌面程序，2026-10-18 仍在推送）；`cawel/subtitles-validator` 9★。

**判读（软论据，不称首创）**：QC 赛道总量极小；头部要么是桌面巨兽，要么是 0–3★ 一次性脚本。「单文件 HTML + SRT/VTT/ASS 统一 + 中文阈值 + 行号定位 + 可逆修复」这一格未见产品化项目。需警惕 0★ 的 `drama-subtitle-qc`（2026 年短剧出海方向）——说明需求已被少数人嗅到，但未产品化。

### 1.3 技术事实（✅ 浏览器标准 API）

| 事实 | 依据 | 状态 |
|---|---|---|
| 本地文件读取不需上传 | File API / `FileReader` / `Blob`，`file://` 下可用 | ✅ |
| 编码嗅探与 GBK 解码 | `TextDecoder`（`utf-8` 严格模式 + `gbk` 回退），浏览器原生 | ✅ |
| 报告与文件导出 | `Blob` + `URL.createObjectURL` + `<a download>` | ✅ |
| 单文件可双击运行 | 全部 CSS/JS 内联，无 ES module 跨文件引用（或构建时内联） | ✅ |
| 无需 WASM / 无需模型 | 四类规则均为字符串与时间戳运算 | ✅ |
| 目标体积与 10MB/5000 cue 时延 | 设计目标，**未实测** | ⬜ 待 M5 基准回填 |

---

## 2. 数据源可获取性记录

| 数据源 | 可获取性 | 说明 / 阻断原因 |
|---|---|---|
| 外部字幕库 / 片源 | **不可获取，且不使用** | 版权红线：不下载、不内置、不入仓任何真实影视字幕。 |
| 外部标准文档（平台审核规则） | **不可获取** | 各平台隐式规则不公开、易过期，**不得作为判定底座**；本题阈值一律为自定口径（见 §4）。 |
| 公开字幕格式规范（SRT/VTT/ASS 语法） | ✅ 已确认语法 | 格式语法为公开事实，仅用于解析器实现，不引入第三方代码。 |
| 自建合成样本 | ✅ 可完全获取 | 由生成脚本程序化产出，带植入真值（见 §3）。 |
| 人工标注 cue（200 条）与 golden set（30 条） | ✅ 可完全获取 | 由项目自建并逐条标注，标注准则写在 `data/truth/`。 |

**结论**：本题**无任何外部数据依赖**。全部样本与真值自建，因此不存在"上游改版导致基准失效"的风险；代价是必须自己保证样本的覆盖度与真实性。

**阻断纪律**：任何 ⬜ 项不得进入首期判定路径；若后续引入外部样本，先做格式核对并把本文档三态升级为 ✅ 后再使用。

---

## 3. 合成数据纪律

### 3.1 内容白名单（硬约束）

- **剧名**：只用虚构名，统一前缀 `示例剧` / `Sample Show`（如 `示例剧·夜航`、`Sample Show S01E01`），**不得使用任何真实影视作品名、角色名、演员名**。
- **对白**：只用自造句子或公版文本（如常识性短句、无版权短语），**不得复制任何真实字幕、剧本、小说段落**。
- **人名/机构名**：只用 `角色甲` / `角色乙` / `Character A` 一类占位名，或明确虚构的姓名。
- **语言**：中文、英文、日文三种，每种至少覆盖一组长句、一组短句、一组混排。

### 3.2 生成与真值

- 样本由脚本生成（`tools/gen_samples.mjs`，M1 产出），**每个缺陷由脚本显式植入**，同时写出真值文件 `data/truth/<sample>.json`（记录缺陷的 `ruleId` + 行号 + 期望值）。
- 真值文件与样本文件**同提交入仓**，任何样本改动必须同步改真值；对账脚本 `tools/check_truth.mjs` 校验两者条数一致。
- **随机性**：如生成器含随机（如随机选句），必须固定种子并在样本头部注释记录；同一命令重复运行产出**逐字节一致**的样本。
- **覆盖度**：真值按规则域逐项列全（格式变体 8 类 × 3 格式、时序 12 类、可读性 7 类、卫生 10 类）。任一规则没有正例即视为覆盖不足，不得进入 M2 之后。

### 3.3 样本目录约定

```
data/samples/format/   24 份格式变体（3 格式 × 8 变体）
data/samples/timing/   12 类时序缺陷样本
data/samples/readability/ 200 条标注 cue（可合并为少量文件）
data/samples/hygiene/  30 条 golden set
data/truth/            与 samples 一一对应的真值 JSON
```

---

## 4. 数值口径（**单一真相源**）

> 本节是全项目阈值与参数的**唯一定义处**。`plan/01` 与代码、报告只引用口径键，不写第二份数值表述。
> **修改任何数值必须改本节并在同一提交里同步代码默认值**；报告中必须显示实际生效值与 `ruleset_version`。

### 4.1 口径属性声明

- 以下阈值**均为本项目自定口径**，不是任何平台、标准或行业规范的转述（无法查证的外部规则不得作底座）。
- `ruleset_version` 是本节内容的版本标识；**本节任一数值变动即递增版本号**，报告与测试都断言版本一致。
- 数值比较一律用**定点整数**（字符数 × 1000 / 毫秒），不使用浮点直接比较，避免边界抖动。

### 4.2 阅读速度（CPS，字符/秒）

| 口径键 | 中文 | 英文 | 日文 | 说明 |
|---|---|---|---|---|
| `cps.zh` | 9 | — | — | 全角字符计 1 |
| `cps.en` | — | 17 | — | 半角字符计 1 |
| `cps.ja` | — | — | 9 | 全角字符计 1 |
| `cps.mixed` | 按 cue 内主导文字类别判定 | | | 混合行按"全角计数 × 1000 / 毫秒"折算后与对应档比较 |

- 计数规则：标签、ASS 覆写块、SDH 标记、空白、换行**不计入**；全角字符计 1，半角计 0.5（仅用于行长与混合行折算）。
- 判定式（定点）：`chars_milli / duration_ms > cps_limit` → 报 `readability.cps`。
- **可调**：界面提供 0.5×–1.5× 倍率，报告记录实际生效值。

### 4.3 行长与行数

| 口径键 | 值 | 说明 |
|---|---|---|
| `line.maxWidthFull` | 16 全角 | 中文/日文单行上限 |
| `line.maxWidthHalf` | 42 半角 | 英文单行上限 |
| `line.maxLines` | 2 | 显示行数上限 |
| `line.minChars` | 2 | 单条可见字符下限 |

### 4.4 时长与间隔

| 口径键 | 值 | 说明 |
|---|---|---|
| `duration.min` | 800 ms | 低于即报 `readability.duration-short` |
| `duration.max` | 7000 ms | 高于即报 `readability.duration-long` |
| `timing.gapMin` | 80 ms | 相邻 cue 间隔小于此值即报 `timing.gap-too-small` |
| `timing.overlapTolerance` | 0 ms | 重叠判定不做容差（`next.start < cur.end` 即报） |

### 4.5 fps 漂移拟合

| 口径键 | 值 | 说明 |
|---|---|---|
| `drift.offsetRange` | −30000 … +30000 ms | 粗搜范围 |
| `drift.offsetStepCoarse` | 100 ms | 粗搜步长 |
| `drift.offsetStepFine` | 5 ms | 局部细化步长 |
| `drift.scaleRange` | 0.90 … 1.10 | 速率范围（覆盖 23.976/24/25/29.97 互转） |
| `drift.scaleStepCoarse` | 0.001 | 粗搜步长 |
| `drift.scaleStepFine` | 0.00005 | 局部细化步长 |
| `drift.residualMaxMs` | 40 ms | 残差中位数超过即报 `timing.fps-drift` |
| `drift.tieBreak` | 先取 offset 更小，再取 scale 更小 | 并列最优的确定性取舍 |

- 拟合模型：`expected ≈ offset + scale × actual`（或反向，方向在 `plan/03` 写死一处）。
- 只用通过 T01–T10 的"干净对"作样本；样本数少于口径下限（`drift.minSamples = 20`）时输出 `skipped`，不报漂移。

### 4.6 卫生规则参数

| 口径键 | 值 | 说明 |
|---|---|---|
| `hygiene.allCapsMinLength` | 20 半角字符 | 达到此长度才判全大写 |
| `hygiene.repeatPunctMin` | 3 | 连续同类标点 ≥ 3 次才报 |
| `hygiene.whitelist` | 见 ruleset 文件 | 已知不报的词（`iPhone`、`e.g.`、`♪` 等），命中次数在报告显示 |

### 4.7 确定性导出

| 口径键 | 值 | 说明 |
|---|---|---|
| `report.schemaVersion` | `1` | 报告结构版本 |
| `report.rulesetVersion` | `1` | 与本节同步递增 |
| `report.includeTimestamp` | `false`（默认） | 勾选后报告标注"非确定性导出" |
| `report.pathInOutput` | `false` | 报告不含本机绝对路径 |
| `report.sortKeys` | `(line, ruleId)` | findings 排序固定 |

### 4.8 性能口径

| 口径键 | 值 | 说明 |
|---|---|---|
| `perf.targetInput` | 10 MB / 5000 cue | 基准样本规模 |
| `perf.targetWallMs` | 2000 ms | 设计目标；**实测值以末态回填**，不作跨机器硬承诺 |

> 以上 `perf.*` 为设计目标，M5 基准实测后把结果写入 `plan/RELEASE-M6.md` 与技术报告，不在 README 里写成已达成。
