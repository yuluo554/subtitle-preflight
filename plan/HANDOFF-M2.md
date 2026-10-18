# HANDOFF-M2 · 下一棒 = 解析

> 用法（相对路径）：本文件 `plan/HANDOFF-M2.md`。新对话启动时由用户侧拼绝对路径。
> 第一动作：`node tools/check-sprint-layout.mjs`（红了先修布局，再干活）。

## 一、当前进度 + 证据

M0（装订 + 计划 + 骨架）已提交；**M1（数据先行）已完成，工作树待提交**（尚未 commit——接棒时先确认提交边界）。

> 建议提交边界：一次提交含 `data/samples/**`、`data/truth/**`、`tools/gen-samples.mjs`、`tools/samples/**`、
> `tools/check-truth.mjs`、`tests/samples_generator.test.mjs`、`tests/truth.test.mjs`、`package.json`、
> `.gitattributes`、`.github/workflows/ci.yml` 与 `plan/**`、`README.md`、`data/README.md` 的对应改动。

| 产物 | 位置 | 证据（命令 / 结果） |
|---|---|---|
| 样本生成器 | `tools/gen-samples.mjs` + `tools/samples/**` | `--check` 85 文件逐字节一致、无孤儿 |
| 格式变体 | `data/samples/format/`（24）+ `data/truth/format/`（24） | `TRUTH.PAIRS` 42 样本 ↔ 42 真值 |
| 时序样本 | `data/samples/timing/`（13 = 12 类 + 干净基线） | 每类都由独立判定式复算命中 |
| 可读性标注 | `data/samples/readability/`（4 文件 / 200 cue） | 逐条手写期望 vs 独立判定式逐条对账 |
| 卫生 golden set | `data/samples/hygiene/hygiene-golden.srt`（30 cue） | 10 正例 + 10 已知不报 + 10 边界 |
| 真值门 | `tools/check-truth.mjs` | 7 项检查全绿（一一对应 / 禁观测字段 / 覆盖率 / 清单对账 / 内容白名单 / 矩阵） |
| 覆盖度矩阵 | `data/truth/coverage.json` | 29 条规则（12+7+10），引用样本全部存在 |
| 标注准则 | `data/truth/README.md` | 被 `check-truth` 解析；与机器清单逐项一致 |
| 位级保真 | `.gitattributes` | `data/samples/**`、`data/truth/**` 声明 `-text`（实测 git blob 保留 `\r\n`） |
| 测试 | `tests/samples_generator.test.mjs`、`tests/truth.test.mjs` | 18 项全绿；其中 6 项是**变异反例** |
| CI | `.github/workflows/ci.yml` | 本地 YAML 解析通过（新增 2 step）；**未推送，CI 待首推验证** |

**SRT 侧已闭环**：8 份 SRT 格式样本的 cue 边界 / 行号映射 / `declaredIndex` 被**当前解析器 0 容差复现**
（`tests/samples_generator.test.mjs`）。VTT/ASS 的 16 份真值是 M2 的**目标契约**，本轮只做结构校验。

## 二、下一棒待办（M2 解析）

目标：**24 份格式样本全部 0 容差**（cue 数 / 起止时间 / 行号映射），并补齐解析层契约。

1. **VTT 解析器**（`src/core/parse/vtt.js` + 注册进 `tools/bundle.mjs` 的 `SOURCE_FILES`）
   - 首行 `WEBVTT`（允许其后有 header 文本）；`NOTE` / `STYLE` / `REGION` 整块跳过并**计数**；
   - cue 标识行可有可无；时间码 `MM:SS.mmm` 与 `HH:MM:SS.mmm` 都接受；`-->` 后可带 settings；
   - 目标：`vtt-v1..v8` 全部与 `data/truth/format/vtt-*.json` 一致。
2. **ASS 解析器**（`src/core/parse/ass.js`）
   - 只取 `[Events]`；按 `Format:` 行建立 `字段名 → 列位` 映射（**不假设固定列位**，`ass-v3` 会乱序）；
   - `Comment:` 行跳过并计数；时间码 `H:MM:SS.cc` → 毫秒；`\N` 拆行；`sourceLine = Dialogue 行号`。
3. **SRT 带符号时间码**（G11）：小时位允许前导 `-`，解析出负毫秒 → 让 `timing/t07-negative-start.srt` 产出
   `timing.negative-start`。**这是 T07 唯一输入形态，不做则 M3 的"12 类 100% 检出"不可能达成。**
4. **VTT/ASS 诊断码**（G12）：`parse.skipped-block`（带起止行号）、`parse.skipped-comment`（带行号）。
   真值里已声明，见 `data/truth/format/vtt-v4-note-block.json` / `ass-v4-comment-line.json`。
5. **块内空行口径**（G13）：现行口径下 SRT 块内空行 = 块终止符（`v8` 样本只覆盖块间/首尾空行）。
   若决定容忍，必须**同提交**改样本 + 真值 + `data/truth/README.md`，并重跑 `--check`。
6. **解码层对齐**：`decode.gbk-fallback` 已在真值里；确认 CRLF/BOM 变体在文件卡片与报告里都有标注。
7. 收尾：写 `plan/HANDOFF-M3.md`；回写三处状态副本；把 `plan/06` 的 G01/G11/G12/G13 判据改为"已达成 + 证据位置"。

## 三、既定口径清单（K 编号，动了会打挂测试）

- **K1**：阈值只在 `data/README.md` §4；`data/ruleset.v1.json` 是其镜像，由 `check-ruleset` 强制一致，**必须同提交修改**。
- **K2**：`src/core/**` 纯函数——不碰 DOM、不发网络、不读时钟、不读 locale、不用 `Math.random`。
- **K3**：`src/ui/**` 只消费 `core/pipeline`，不实现判定、不写阈值、不直接依赖 `core/rules/**`。
- **K4**：构建与测试共用 `tools/bundle.mjs` 的 `SOURCE_FILES`；清单必须等于 `src/**/*.js` 实际集合（**新增解析器文件必须同步**）。
- **K5**：报告无时间戳 / 随机 ID / 本机路径；findings 按 `(line, ruleId)` 排序；键序固定。
- **K6**：单文件产物零外链、零网络调用。
- **K7**：未实现能力必须进 `skipped[]` 与 `capabilities`，不得静默返回空。**VTT/ASS 一旦实现，要同步撤掉 `not_implemented` 声明**。
- **K8**：状态副本 3 处（`plan/00` / `plan/05` / `README`）逐处一致。
- **K9**：收尾必须写下一棒交接单（布局门断言"下一待办里程碑的 HANDOFF 已落盘"）。
- **K10**：测试文件必须逐项列进 `package.json` 的 `test` 脚本。
- **K11（M1 新增）**：真值只存输入与期望——`expectFindings` 只允许 `ruleId`/`line`/`field`；
  实现在改口径时**不得**直接把 `observed` 写进真值（`check-truth` 会红）。
- **K12（M1 新增）**：`data/samples/**` 与 `data/truth/**` 是**字节即口径**（CRLF/BOM/GBK），
  `.gitattributes` 已声明 `-text`；不要对这两个目录做任何行尾/编码归一。
- **K13（M1 新增）**：标注器（`tools/samples/*oracle.mjs`）**不得 import `src/core/**`**——
  它与实现必须互为差分对照，否则真值退化成"比对两份预先算好的答案"。

## 四、本机环境坑（只写实测过的）

- Node `v24.15.0`；`TextDecoder('gbk')` 可用（GBK 样本靠它反查编码，生成时做往返自证）。
- 本机 Windows + Git Bash：临时目录用 `os.tmpdir()`，别用 `/tmp/...` 传给原生程序。
- **`.gitattributes` 的 `* text=auto eol=lf` 会在 clone 时把 CRLF/BOM 样本归一化** →
  已用 `data/samples/** -text` / `data/truth/** -text` 挡住（实测 git blob 保留 `\r\n`）。新增样本目录时别忘了这一条。
- 远端**未建**：任何"CI 绿"必须写成"本地等价校验（未接远端，CI 待首推验证）"。
- `dist/` 在 `.gitignore` 里只放行 `subtitle-preflight.html` 与 `.gitkeep`；构建产物**入仓**。
- 解析器改动后必须 `node tools/build.mjs`（产物入仓），否则 `build.mjs --check` 与 `build.test.mjs` 会红。

## 五、DoD 逐项 checklist（M2）

- [ ] `src/core/parse/vtt.js` 存在，进 `SOURCE_FILES`，`vtt-v1..v8` 与真值 0 容差
- [ ] `src/core/parse/ass.js` 存在，进 `SOURCE_FILES`，`ass-v1..v8` 与真值 0 容差
- [ ] 24 份格式样本：cue 数 / 起止时间 / 行号映射（`sourceLine`/`timeLine`/`endLine`/`textLineNumbers`）**0 容差**
- [ ] SRT 接受前导负号 → `t07-negative-start.srt` 产出 `timing.negative-start`（G11）
- [ ] VTT `NOTE`/`STYLE`/`REGION` 与 ASS `Comment:` 分别产出 `parse.skipped-block` / `parse.skipped-comment`（G12）
- [ ] `capabilities.parsers.vtt/ass` 改为 `implemented`，并从 `skipped[]` 撤下 `parser.not_implemented`
- [ ] 新增测试文件（如 `tests/parse_vtt.test.mjs`、`tests/parse_ass.test.mjs`）逐项列入 `package.json` 的 `test`
- [ ] `npm test` 全绿；`node tools/build.mjs --check` 绿（产物已重建）
- [ ] `node tools/gen-samples.mjs --check` 绿；`node tools/check-truth.mjs` 绿
- [ ] `node tools/check-sprint-layout.mjs` 绿；`node tools/check-ruleset.mjs` 绿；`node tools/selftest-layout.mjs` 绿
- [ ] `node tools/e2e-browser.mjs` 全绿（缺浏览器时 exit 3 记"环境缺失"，不记通过）
- [ ] `plan/HANDOFF-M3.md` 已落盘；三处状态副本已回写；`plan/06` 缺口表对应行改为已达成

## 六、关键命令速查

```bash
node tools/check-sprint-layout.mjs     # 布局门（第一件事）
node tools/check-ruleset.mjs           # 口径门
node tools/check-truth.mjs             # 真值门（样本 ↔ 真值 / 覆盖度 / 内容白名单）
node tools/gen-samples.mjs --check     # 样本与真值位级一致 + 无孤儿
node tools/selftest-layout.mjs         # 布局门 7 组变异自检
npm test                               # 全量测试（逐文件列出；M1 后 10 个文件 / 102 项）
node tools/build.mjs                   # 构建单文件产物（改 src 后必须跑）
node tools/build.mjs --check           # 产物与源码同基线
node tools/e2e-browser.mjs             # 浏览器 e2e（需本机 Chrome/Edge；缺则 exit 3）
npm run verify                         # 三道门 + 生成器位级检查 + 测试 + 构建检查
```
