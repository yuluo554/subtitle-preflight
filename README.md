# 字幕投放前体检 · subtitle-preflight

把 `.srt` / `.vtt` / `.ass` 拖进一个 HTML 文件，浏览器内解析，按「时序 / 阅读速度 / 行长 / 排版卫生」四类确定性规则体检，输出**带源文件行号定位**的 JSON / Markdown / CSV 报告 + 只做**可逆修复**的字幕文件。

零安装、零上传、断网可用——现有字幕工具要么是 C# 桌面巨兽（SubtitleEdit 14603★），要么是 0–3 星一次性脚本。

> **当前状态**：M0 骨架 + M1 基准数据 + M2 解析层 + M3 时序 + M4 可读性 + M5 卫生与报告已落地。
> 四类规则全部实现：时序 T01–T12（含 fps 漂移拟合）、可读性 R01–R07、**卫生 S01–S10**；
> 三格式报告 JSON / Markdown / CSV 同源，**可逆修复**导出修复后字幕；
> 24 份格式样本 / 12 类时序样本 / 200 条可读性标注 / 30 条卫生 golden set 与全套真值端到端 **0 容差**。
> 10MB / 5000 cue 性能已**实测回填**（本机中位 1.24s，见下方「性能」）。
> 仅剩 M6 发布（tag + Release + CI 首推）未做——详见下方「已知限制」。

## 里程碑状态

| 里程碑 | 主题 | 状态 |
|---|---|---|
| M0 | 方法论装订 + 计划 + 可运行骨架 | ✅ |
| M1 | 数据先行 | ✅ |
| M2 | 解析 | ✅ |
| M3 | 时序 | ✅ |
| M4 | 可读性 | ✅ |
| M5 | 卫生与报告 | ✅ |
| M6 | 发布 | ⬜ |

## 快速开始

1. 打开 `dist/subtitle-preflight.html`（双击即可，无需服务器）。
2. 把字幕文件拖进页面，或展开"粘贴字幕文本"贴一段。
3. 看「体检结果」；点「导出 JSON / Markdown / CSV」拿到带行号的机读报告，
   或点「导出修复后字幕」拿到只做了可逆修复的新文件。
**不安装任何东西、不联网。** 文件只在浏览器内存里被读取。

> 可选：填「素材帧率（fps）」可启用 **fps 漂移拟合**——当字幕帧率与素材帧率不一致时，
> 整条时间轴会等比漂移；拟合会复原 `scale` / `offset` 并在漂移超限时报 `timing.fps-drift`。

## 支持格式

| 格式 | 解析 | 说明 |
|---|---|---|
| `.srt` | ✅ 已实现 | 容忍序号缺失 / 跳号 / `,` 与 `.` 混用 / 行尾空白 / 空行噪声；起点允许前导 `-` |
| `.vtt` | ✅ 已实现 | `WEBVTT` 头、`NOTE`/`STYLE`/`REGION` 块跳过并计数、短/长时间码、`-->` 后 settings |
| `.ass` / `.ssa` | ✅ 已实现 | `[Events]` + `Format:` 列序映射、`Comment:` 跳过并计数、厘秒、`\N` 拆行 |

格式按**文件内容形态**判别（`WEBVTT` 头 / `[Events]` 段 / `-->`），扩展名只作提示。

编码：UTF-8 BOM / UTF-16LE / UTF-16BE / 无 BOM UTF-8 / GBK 回退。回退会在文件卡片与报告诊断里**显式标注**。

## 规则清单

阈值只在 [`data/README.md` §4](data/README.md) 定义一次；机器可读镜像为 `data/ruleset.v1.json`，由 `node tools/check-ruleset.mjs` 强制逐值一致。

### 时序（`timing.*`）

| ruleId | 判定 | 状态 |
|---|---|---|
| `timing.overlap` | `next.start < cur.end` | ✅ |
| `timing.zero-duration` | `end == start` | ✅ |
| `timing.negative-duration` | `end < start` | ✅ |
| `timing.gap-too-small` | `0 <= gap < timing.gapMin` | ✅ |
| `timing.non-monotonic` | 起点相对前一条倒退 | ✅ |
| `timing.duplicate-cue` | 起止时间与文本完全相同 | ✅ |
| `timing.negative-start` | 起点 < 0 | ✅ |
| `timing.past-media-end` | 末 cue 结束超过声明时长（未填则 `skipped`） | ✅ |
| `timing.unparsable-timecode` | 时间码无法解析 | ✅ |
| `timing.file-order-mismatch` | 文件顺序 ≠ 时间顺序 | ✅ |
| `timing.timecode-precision` | 亚毫秒 / 小时位溢出 / 毫秒位非 3 位 | ✅ |
| `timing.fps-drift` | 帧栅格拟合的残余漂移超限（需填素材帧率） | ✅ |

### 阅读速度 / 行长 / 卫生

| 域 | 规则数 | 状态 |
|---|---|---|
| `readability.*` | 7 | ✅（CPS / 行长 / 行数 / 字符下限 / 时长上下限 / 重复文本；语言档 zh/en/ja） |
| `hygiene.*` | 10 | ✅（CJK–拉丁间距 / 标点宽度 / 行尾句号 / 未闭合标签 / ASS 覆写块残留 / 占位符残留 / `<font>` 残留 / SDH 标记 / 全大写 / 连续重复标点） |

卫生规则的白名单（`iPhone` / `e.g.` / `♪` 等）命中次数会进报告 `summary.whitelist`，
**不静默**；界面有独立的「白名单命中」折叠区。

## 可逆修复

「导出修复后字幕」只做**白名单内的可逆无损动作**：

| 动作 | 改什么 | 不改什么 |
|---|---|---|
| 去重叠 / 修间隔 | 缩短前一条的 `end` | 文本、后一条 |
| 补闭合标签 | 追加 `</i>` / `</b>` / `</u>` | 不新增样式；交叉嵌套不修 |
| 去行尾空白 | 删行尾空格 / 制表符 | 整行只剩空白时不动 |
| 序号重编 | 仅 SRT，只改序号行的数字 | 不重排块序；缺序号行不修 |

**禁止**：改文本、改断句、重排语序、合并或拆分 cue、改字号颜色、删 cue。
缩短时间码时以可读性时长下限作护栏——**每条规则的违规数不得因修复而增加**；
不可修样本 `fixes[]` 为空、文本逐字节不变。修复记录进报告 `fixes[]`，界面有「已应用的修复」折叠区。

## 报告

```json
{
  "schemaVersion": 2,
  "rulesetVersion": 1,
  "inputSha256": "…",
  "summary": {
    "total": 3,
    "bySeverity": { "error": 2, "warn": 1, "info": 0 },
    "byRule": { "timing.overlap": 2 },
    "whitelist": { "iPhone": 1 }
  },
  "findings": [
    { "ruleId": "timing.overlap", "severity": "error", "line": 8, "field": "startMs",
      "expected": ">= 3400", "actual": "3200", "message": "本条起点早于上一条结束" }
  ],
  "fixes": [
    { "ruleId": "timing.overlap", "line": 2, "action": "trim-overlap",
      "before": "00:00:01,000 --> 00:00:03,000", "after": "00:00:01,000 --> 00:00:01,920" }
  ],
  "skipped": [],
  "capabilities": {},
  "diagnostics": []
}
```

三格式**共用同一份 findings 数组**（单一渲染源）：条目数相同、每条的 `ruleId`/`line` 一致；
CSV 列固定 `ruleId,severity,line,field,expected,actual,message`，按 **RFC 4180** 转义。

确定性：键序固定、findings 按 `(line, ruleId)` 排序、无时间戳、无随机 ID、无本机路径。同一输入两次导出**逐字节一致**。

## 隐私承诺

- 文件通过浏览器 File API 读取，**不经过任何网络**。
- 产物内**没有** `<script src>` / `<link>` / `@import` / 远程 `url()` / `fetch` / `XMLHttpRequest` / `WebSocket` / `sendBeacon`；构建时静态断言，测试再断言一次。
- 不上传、不遥测、不内置字幕库或片源。

## 从源码构建

```bash
node tools/build.mjs           # 写出 dist/subtitle-preflight.html
node tools/build.mjs --check   # 断言产物与源码同基线（CI 用）
```

构建把 `src/**` 与 `data/ruleset.v1.json` 内联进 `src/ui/index.html` 的两个占位符。清单与 `src/**/*.js` 实际集合不一致会直接报错（防"新增文件没进产物"）。

## 开发与门禁

```bash
node tools/check-sprint-layout.mjs   # 布局门：计划套件 / 交接单 / 状态副本一致
node tools/check-ruleset.mjs         # 口径门：§4 ↔ ruleset 逐值一致 + 源码零阈值字面量
node tools/check-truth.mjs           # 真值门：样本 ↔ 真值一一对应 / 覆盖度 / 内容白名单
node tools/gen-samples.mjs --check   # 样本与真值是否与生成器逐字节一致（含孤儿检测）
node tools/selftest-layout.mjs       # 布局门的 7 组变异自检（在独立副本里跑）
npm test                             # 全量测试（240 项 / 20 个文件）
node tools/bench.mjs                 # 10MB / 5000 cue 性能基准（本机实测，不写死承诺）
node tools/e2e-browser.mjs           # 浏览器 e2e：从产物文件 headless 打开跑一遍
npm run verify                       # 三道门 + 生成器位级检查 + 测试 + 构建检查
```

运行时零第三方依赖；`node_modules/` 不入仓。

## 基准样本与真值

`data/samples/` 与 `data/truth/` 由 `node tools/gen-samples.mjs` 确定性生成（LF、按 Unicode 码点序、无随机）：

| 域 | 数量 | 内容 |
|---|---|---|
| `format` | 24 | 3 格式（srt/vtt/ass）× 8 变体（BOM / CRLF / 序号缺失 / 序号跳号 / 分隔符与时间码形态 / GBK / 行尾空白 / 空行噪声） |
| `timing` | 13 | 12 类时序缺陷各 1 份 + 1 份干净基线 |
| `readability` | 200 条标注 cue | 中文 60 / 英文 60 / 日文 40 / 混排 40 |
| `hygiene` | 30 条 golden set | 10 正例 + 10 已知不报 + 10 边界 |

真值只存**输入与期望**（`ruleId` + 行号），观测值由规则引擎实算；标注器是独立实现，
不调用本工具的解析/规则代码，因此真值与实现对得上才算通过。标注准则见 [`data/truth/README.md`](data/truth/README.md)。

24 份格式样本（SRT/VTT/ASS 各 8 份）的 cue 边界、行号映射与解析诊断码已与真值 **0 容差**
（`tests/samples_generator.test.mjs`）。时序 13 份、可读性 200 条、卫生 30 条同样端到端 **0 容差**；
卫生 golden set 的 precision 为 **100%**（口径要求 100%），recall 为 **100%**（口径要求 ≥ 90%）。

## 性能（本机实测，不是跨机器承诺）

```bash
node tools/gen-samples.mjs --perf   # → out/perf-10mb-5000cues.srt（不入仓）
node tools/bench.mjs --runs 5
```

| 项 | 实测值 |
|---|---|
| 样本 | 10 558 893 bytes（10.07 MB）/ 5000 cue |
| 全流程（解码 → 解析 → 四域规则 → 报告三格式 → 修复） | min 1102.4 ms / **中位 1242.9 ms** / max 1400.7 ms（5 轮，另有 1 轮预热不计入） |
| 对照口径 `perf.targetWallMs` | 2000 ms → 达标（本机单次实测） |
| 环境 | Node `v24.15.0`，Windows + Git Bash |

> 不同机器、不同 Node 版本**不可比**。`tools/bench.mjs` 只测量并打印，不做"必须达标"的断言。
> 完整实测记录见 [`docs/技术报告.md`](docs/技术报告.md) §7。

## 已知限制

- **CI 未跑过**：本仓库尚未建远端，`npm run verify` 是本地等价校验；浏览器 e2e 已在本机
  headless Chrome 验过（11 项全绿）。**未接远端，CI 待首推验证。**
- **修复白名单是有边界的**：文本层面的缺陷（占位符、ASS 覆写块残留、全大写、SDH 标记、
  交叉嵌套标签、标点宽度、行尾句号、CJK 间距）**不可修**——修它们必然改文本，
  违反"只做可逆无损修复"的红线。这些 finding 会如实报出，但 `fixes[]` 为空。
- **fps 漂移拟合需要用户填写素材帧率**（未填 → 报告 `skipped`，不猜）；拟合复原 `scale`
  误差 < 1 帧（样本实测）。
- **性能是单机单次实测**，不是"任意 10MB 字幕都能 1.2s"的承诺。
- 本工具是投放前的辅助检查，**不构成**对字幕质量或平台审核结果的保证。

## 许可

[MIT](LICENSE)

## 开发文档

- 计划与方法论装订：`AGENTS.md`、`plan/00-README总览.md`
- 架构与模块详设：`plan/02-架构与技术选型.md`、`plan/03-模块详设.md`
- 数值口径唯一真相源：`data/README.md` §4
- 里程碑与发布流程：`plan/05-里程碑与发布.md`
- **技术报告（实测记录）**：`docs/技术报告.md`
