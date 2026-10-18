# 字幕投放前体检 · subtitle-preflight

把 `.srt` / `.vtt` / `.ass` 拖进一个 HTML 文件，浏览器内解析，按「时序 / 阅读速度 / 行长 / 排版卫生」四类确定性规则体检，输出**带源文件行号定位**的 JSON / Markdown 报告 + 只做**可逆修复**的字幕文件。

零安装、零上传、断网可用——现有字幕工具要么是 C# 桌面巨兽（SubtitleEdit 14603★），要么是 0–3 星一次性脚本。

> **当前状态**：M0 骨架 + M1 基准数据已落地（解析 SRT、时序 T01–T10 + T12、JSON 导出、单文件构建，
> 以及 24 份格式样本 / 12 类时序样本 / 200 条可读性标注 / 30 条卫生 golden set 与全套真值）。
> VTT/ASS 解析、可读性、卫生、修复、Markdown/CSV 尚未实现——这些能力在报告的
> `capabilities` 与 `skipped[]` 里**显式声明**，不会被读成"通过"。详见下方「已知限制」。

## 里程碑状态

| 里程碑 | 主题 | 状态 |
|---|---|---|
| M0 | 方法论装订 + 计划 + 可运行骨架 | ✅ |
| M1 | 数据先行 | ✅ |
| M2 | 解析 | ⬜ |
| M3 | 时序 | ⬜ |
| M4 | 可读性 | ⬜ |
| M5 | 卫生与报告 | ⬜ |
| M6 | 发布 | ⬜ |

## 快速开始

1. 打开 `dist/subtitle-preflight.html`（双击即可，无需服务器）。
2. 把字幕文件拖进页面，或展开"粘贴字幕文本"贴一段。
3. 看「体检结果」；点「导出 JSON」拿到带行号的机读报告。

**不安装任何东西、不联网。** 文件只在浏览器内存里被读取。

## 支持格式

| 格式 | 解析 | 说明 |
|---|---|---|
| `.srt` | ✅ 已实现 | 容忍序号缺失 / 跳号 / `,` 与 `.` 混用 / 行尾空白 / 空行噪声 |
| `.vtt` | ⬜ 未实现 | 输入时产出 `parser.not_implemented` 诊断，不会假装通过 |
| `.ass` / `.ssa` | ⬜ 未实现 | 同上 |

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
| `timing.fps-drift` | offset+scale 网格拟合残差超限 | ⬜ 待 M3 |

### 阅读速度 / 行长 / 卫生

| 域 | 规则数 | 状态 |
|---|---|---|
| `readability.*` | 7 | ⬜ 待 M4 |
| `hygiene.*` | 10 | ⬜ 待 M5 |

未实现时，报告 `capabilities.rules.*` 标 `not_implemented`，并写入 `skipped[]`。

## 报告

```json
{
  "schemaVersion": 1,
  "rulesetVersion": 1,
  "inputSha256": "…",
  "summary": { "total": 3, "bySeverity": { "error": 2, "warn": 1, "info": 0 }, "byRule": { "timing.overlap": 2 } },
  "findings": [
    { "ruleId": "timing.overlap", "severity": "error", "line": 8, "field": "startMs",
      "expected": ">= 3400", "actual": "3200", "message": "本条起点早于上一条结束" }
  ],
  "fixes": [],
  "skipped": [],
  "capabilities": {},
  "diagnostics": []
}
```

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
npm test                             # 全量测试
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

## 已知限制

- **VTT / ASS 解析未实现**（M2）。输入这类文件会得到明确诊断，不会静默通过。
  这 16 份样本的真值是 **M2 的目标契约**（`check-truth` 只做结构校验，未与解析器比对）。
- **可读性 7 类、卫生 10 类未实现**（M4/M5）；200 条标注与 30 条 golden set 已落库并写明期望。
- **fps 漂移拟合未实现**（M3）；漂移样本已落库（25fps 素材按 23.976fps 播放）。
- **可逆修复、Markdown / CSV 导出未实现**（M5）；界面按钮置灰并标注里程碑。
- **SRT 带符号时间码未支持**：`-00:00:01,000` 目前判为不可解析，因此"起点为负"这条规则尚无文件级正例（M2 补齐）。
- **性能未实测**：10MB / 5000 cue 的 2s 目标是设计口径，不是已达成承诺；样本可由 `--perf` 生成到 `out/`。
- **CI 未跑过**：本仓库尚未建远端，`npm run verify` 是本地等价校验；浏览器 e2e 已在本机 headless Chrome 验过。
- 本工具是投放前的辅助检查，**不构成**对字幕质量或平台审核结果的保证。

## 许可

[MIT](LICENSE)

## 开发文档

- 计划与方法论装订：`AGENTS.md`、`plan/00-README总览.md`
- 架构与模块详设：`plan/02-架构与技术选型.md`、`plan/03-模块详设.md`
- 数值口径唯一真相源：`data/README.md` §4
- 里程碑与发布流程：`plan/05-里程碑与发布.md`
