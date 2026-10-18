# HANDOFF-M3 · 下一棒 = 时序（12 类 100% 检出 / 误报 0）

> 用法（相对路径）：本文件 `plan/HANDOFF-M3.md`。新对话启动时由用户侧拼绝对路径。
> 第一动作：`node tools/check-sprint-layout.mjs`（红了先修布局，再干活），随后 `node tools/check-ruleset.mjs`。

## 一、当前进度 + 证据

M0（装订）、M1（数据先行）、**M2（解析）已完成并提交**。

| 产物 | 位置 | 证据（命令 / 结果） |
|---|---|---|
| VTT 解析器 | `src/core/parse/vtt.js` | 8 份 VTT 样本与真值 0 容差 |
| ASS 解析器 | `src/core/parse/ass.js` | 8 份 ASS 样本与真值 0 容差 |
| 分派 | `src/core/parse/index.js` | 三格式均分派到已实现解析器；未知格式仍 `parser.unsupported` |
| 清单同步 | `tools/bundle.mjs` `SOURCE_FILES` | 11 个源文件 == `src/**/*.js` 实际集合（构建门断言） |
| G11 负号 | `src/core/parse/srt.js` | `t07-negative-start.srt` 端到端产出 `timing.negative-start@2:startMs` |
| G11 顺带 | `src/core/parse/srt.js` | 补齐真值早已声明的 `parse.missing-index` / `parse.index-mismatch` |
| G12 诊断 | vtt.js / ass.js | `vtt-v4` → `parse.skipped-block@12`；`ass-v4` → `parse.skipped-comment@14` |
| G13 口径 | `data/truth/README.md` §2.9 + `tests/parse_srt.test.mjs` | 块内空行 = 块终止符；孤儿内容报 `timing.unparsable-timecode`（不容忍，样本/真值未改） |
| capabilities | `src/core/pipeline.js` | `parsers.{srt,vtt,ass}` 全 `implemented`；`parser.not_implemented` 已撤下 |
| 24 份 0 容差 | `tests/samples_generator.test.mjs` | cue 数 / 各字段 / 诊断码（剔除 `decode.*`）逐项相等 |
| 时序端到端 | `tests/samples_generator.test.mjs` | 13 份时序样本：**11/12 类 + 干净基线** 与 `expectFindings` 0 容差 |
| 新测试 | `tests/parse_vtt.test.mjs`、`tests/parse_ass.test.mjs`、`tests/parse_srt.test.mjs` | `npm test` 133 项全绿（M1 后 102 项） |
| 产物 | `dist/subtitle-preflight.html` | `node tools/build.mjs --check` 绿（53901 bytes） |
| 门 | 布局 / 口径 / 真值 / 变异自检 / 生成器 / e2e | 六项全绿（e2e 实测 7 项 PASS，`E2E.NO_NETWORK` 外网请求 = 0） |

> **本机实测**：Node `v24.15.0`。CI 未接远端，任何"CI 绿"必须写成"本地等价校验（未接远端，CI 待首推验证）"。

## 二、下一棒待办（M3 时序）

目标：**12 类时序规则 100% 检出 / 误报 0**，并把 T11（fps 漂移拟合）补齐。T01–T10、T12 已在 M2 端到端 0 容差。

1. **T11 fps 漂移拟合**（`src/core/rules/timing.js` + 视需要新文件，注册进 `SOURCE_FILES`）
   - 契约样本 `data/truth/timing/t11-fps-drift.json`：`expectFindings = [{ruleId:"timing.fps-drift", line:1, field:"fit"}]`；
     声明 fps `{declared: 23.976, playback: 25}`；`expectedFit = {scale: 1.042709, offsetMs: 0, residualMaxMs: 40}`。
   - 算法口径在 `plan/03 §二` 与 `data/README.md` §4（`drift.*` 键）：先粗搜再局部细化，残差中位数 > `drift.residualMaxMs` 即报；并列最优按 `drift.tieBreak`。**只读 ruleset 键，不写阈值字面量**（口径门会红）。
   - 实现后必须**同提交**撤下 `skipped[]` 中的 `{ruleId:"timing.fps-drift", reason:"not_implemented"}`，
     并把 `data/truth/timing/t11-fps-drift.json` 的 `implementationStatus` 改为已实现（该字段不是观测值，不违反 K11）。
2. **⚠️ T11 硬冲突（必须先决策，见 G14）**：口径 `drift.minSamples = 20`，但 `t11-fps-drift.srt` 只有 **8 条 cue** ⇒
   按现行口径 T11 **永远进 `skipped`，不可能产出 finding**，M3 的"12 类 100%"因此不可能达成。二选一：
   - **(a) 扩样本**：把 t11 样本补到 ≥20 条 cue（同提交改样本 + 真值 + `coverage.json`，重跑 `gen-samples --check` 与 `check-truth`）；或
   - **(b) 改口径**：下调 `drift.minSamples`（**K1：`data/README.md` §4 与 `data/ruleset.v1.json` 必须同提交**，并说明为何 8 条也够）。
   建议 (a)：口径是拟合稳定性的保障，不该为了样本方便而放松。
3. **误报对照**：`timing-clean-baseline.srt` 必须仍然 0 finding；新增反例测试（漂移在容差内不报、样本不足进 `skipped` 不报）。
4. **双跑确定性**：拟合结果的 `scale`/`offsetMs` 双跑逐字段一致；报告仍受 K5 约束（无时间戳/随机 ID/本机路径）。
5. **收尾**：写 `plan/HANDOFF-M4.md`；回写三处状态副本（`plan/00` / `plan/05` / `README`）；把 `plan/06` 的 G02/G14 判据改为"已达成 + 证据位置"。

## 三、既定口径清单（K 编号，动了会打挂测试）

- **K1**：阈值只在 `data/README.md` §4；`data/ruleset.v1.json` 是其镜像，由 `check-ruleset` 强制一致，**必须同提交修改**。漂移相关键：`drift.*`。
- **K2**：`src/core/**` 纯函数——不碰 DOM、不发网络、不读时钟、不读 locale、不用 `Math.random`。
- **K3**：`src/ui/**` 只消费 `core/pipeline`，不实现判定、不写阈值、不直接依赖 `core/rules/**`。
- **K4**：构建与测试共用 `tools/bundle.mjs` 的 `SOURCE_FILES`；清单必须等于 `src/**/*.js` 实际集合（**新增文件必须同步**）。
- **K5**：报告无时间戳 / 随机 ID / 本机路径；findings 按 `(line, ruleId)` 排序；键序固定。
- **K6**：单文件产物零外链、零网络调用。
- **K7**：未实现能力必须进 `skipped[]` 与 `capabilities`，不得静默返回空。**T11 一旦实现，必须撤下它的 `not_implemented` 声明**（实现与 `tools/samples/timingoracle.mjs` 两处）。
- **K8**：状态副本 3 处（`plan/00` / `plan/05` / `README`）逐处一致。
- **K9**：收尾必须写下一棒交接单（布局门断言"下一待办里程碑的 HANDOFF 已落盘"）。
- **K10**：测试文件必须逐项列进 `package.json` 的 `test` 脚本。
- **K11**：真值只存输入与期望——`expectFindings` 只允许 `ruleId`/`line`/`field`；不得把 `observed` 写进真值。
- **K12**：`data/samples/**` 与 `data/truth/**` 是**字节即口径**（CRLF/BOM/GBK），`.gitattributes` 已声明 `-text`。
- **K13**：标注器（`tools/samples/*oracle.mjs`）**不得 import `src/core/**`**——它与实现必须互为差分对照。
- **K14（M2 新增）**：解析层输出的**诊断码**（`parse.*`）也是 0 容差契约的一部分，不只是 cue 边界。
  `tests/samples_generator.test.mjs` 对 24 份样本同时断言诊断码（`decode.*` 归解码层，比对时剔除）。

## 四、本机环境坑（只写实测过的）

- Node `v24.15.0`；`TextDecoder('gbk')` 可用。本机 Windows + Git Bash：临时目录用 `os.tmpdir()`。
- 改 `src/**` 后**必须** `node tools/build.mjs`（产物入仓），否则 `build.mjs --check` 与 `tests/artifact_e2e.test.mjs` 会红。
- `tests/artifact_e2e.test.mjs` 跑在**产物脚本**上（`node:vm` 新 realm），跨 realm 对象原型不同——比对象用 `JSON.stringify` 往返。
- 布局门的 GAPS 检查按**表头定位「缺口」列**并扫描该列：`plan/06` 里任何含「缺口」表头的表，
  其「缺口」列单元格**不得出现已 ✅ 的里程碑号**（`M0`/`M1`/`M2`…）。M2 收尾时已把评分对标表的 "M2–M5 待完成" 改成 "M3–M5"。
- **`git commit` 边界**：M2 的提交建议一次含 `src/core/parse/**`、`src/core/pipeline.js`、`tools/bundle.mjs`、
  `tests/**`、`package.json`、`dist/subtitle-preflight.html` 与 `plan/**`、`README.md`、`data/truth/README.md`。
- 远端**未建**：任何"CI 绿"必须写成"本地等价校验（未接远端，CI 待首推验证）"。

## 五、DoD 逐项 checklist（M3）

- [ ] T11 拟合实现：`t11-fps-drift.srt` 端到端产出 `timing.fps-drift@1:fit`
- [ ] G14 决策已落：样本扩到 ≥20 或口径下调（同提交改 §4 + ruleset / 样本 + 真值），并有决策记录
- [ ] 12 类时序端到端与 `expectFindings` **0 容差**（`tests/samples_generator.test.mjs` 的 pending 断言收紧为"无 pending"）
- [ ] 干净基线仍 0 finding（误报 0）
- [ ] 漂移拟合双跑逐字段一致；新增反例测试（容差内不报 / 样本不足进 skipped）
- [ ] 实现与 `tools/samples/timingoracle.mjs` 两处都撤下 `timing.fps-drift` 的 `not_implemented`
- [ ] 新增测试文件逐项列入 `package.json` 的 `test`
- [ ] `npm test` 全绿；`node tools/build.mjs --check` 绿（产物已重建）
- [ ] `node tools/gen-samples.mjs --check` 绿；`node tools/check-truth.mjs` 绿
- [ ] `node tools/check-sprint-layout.mjs` 绿；`node tools/check-ruleset.mjs` 绿；`node tools/selftest-layout.mjs` 绿
- [ ] `node tools/e2e-browser.mjs` 全绿（缺浏览器时 exit 3 记"环境缺失"，不记通过）
- [ ] `plan/HANDOFF-M4.md` 已落盘；三处状态副本已回写；`plan/06` 缺口表 G02/G14 改为已达成

## 六、关键命令速查

```bash
node tools/check-sprint-layout.mjs     # 布局门（第一件事）
node tools/check-ruleset.mjs           # 口径门
node tools/check-truth.mjs             # 真值门（样本 ↔ 真值 / 覆盖度 / 内容白名单）
node tools/gen-samples.mjs --check     # 样本与真值位级一致 + 无孤儿
node tools/selftest-layout.mjs         # 布局门 7 组变异自检
npm test                               # 全量测试（M2 后 12 个文件 / 133 项）
node tools/build.mjs                   # 构建单文件产物（改 src 后必须跑）
node tools/build.mjs --check           # 产物与源码同基线
node tools/e2e-browser.mjs             # 浏览器 e2e（需本机 Chrome/Edge；缺则 exit 3）
npm run verify                         # 三道门 + 生成器位级检查 + 测试 + 构建检查
```
