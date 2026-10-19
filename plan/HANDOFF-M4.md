# HANDOFF-M4 · 下一棒 = 可读性（7 类 100% 与 200 条标注一致）

> 用法（相对路径）：本文件 `plan/HANDOFF-M4.md`。新对话启动时由用户侧拼绝对路径。
> 第一动作：`node tools/check-sprint-layout.mjs`（红了先修布局，再干活），随后 `node tools/check-ruleset.mjs`。

## 一、当前进度 + 证据

M0（装订）、M1（数据先行）、M2（解析）、**M3（时序）已完成并提交**。

| 产物 | 位置 | 证据（命令 / 结果） |
|---|---|---|
| 12 类时序规则 | `src/core/rules/timing.js` | T01–T12 全类 `implemented`；13 份时序真值端到端 0 容差 |
| fps 漂移拟合内核 | `src/core/rules/drift.js` | 帧栅格参考轴 + offset/scale 二维网格 + 残余漂移判据；`tests/drift_fit.test.mjs` 12 项 |
| 独立判定式（真值侧） | `tools/samples/timingoracle.mjs` | `fitDriftOracle` + `cleanPairStarts`；**不 import src/core**（差分对照） |
| T11 样本 | `data/samples/timing/t11-fps-drift.srt` | **24 条 cue**（G14 决策 (a)），起点落在声明帧栅格（23.976fps） |
| T11 真值 | `data/truth/timing/t11-fps-drift.json` | `expectFindings = [{ruleId:"timing.fps-drift", line:1, field:"fit"}]`；`implementationStatus: "implemented"` |
| 复原精度 | 同上 | 复原 `scale=1.0427`（真值 1.042709），误差 **0.07ms**（1 帧 @25fps = 40ms） |
| 双跑确定性 | `tests/drift_fit.test.mjs` | 拟合结果双跑**逐字段一致**；报告双跑逐字节一致 |
| 反例 | `tests/timing_rules.test.mjs` + `tests/drift_fit.test.mjs` | 容差内不报 / 样本不足 `skipped` / 未声明帧率 `skipped` / 不落格 `skipped` / 纯偏移不报 |
| 干净基线 | `tests/samples_generator.test.mjs` | `timing-clean-baseline.srt` 仍 0 finding（误报 0） |
| capabilities | `src/core/pipeline.js` | `rules.timing = "implemented"`、`driftFit = "implemented"` |
| 界面 | `src/ui/index.html` + `src/ui/app.js` | 新增"素材帧率（fps）"输入框 → `declaredFps` |
| 新测试 | `tests/drift_fit.test.mjs` | `npm test` **149 项全绿**（M2 后 133 项） |
| 产物 | `dist/subtitle-preflight.html` | `node tools/build.mjs --check` 绿（64520 bytes） |
| 门 | 布局 / 口径 / 真值 / 变异自检 / 生成器 | 全绿（`gen-samples --check` 85/85 逐字节一致） |

> **本机实测**：Node `v24.15.0`。CI 未接远端，任何"CI 绿"必须写成"本地等价校验（未接远端，CI 待首推验证）"。

## 二、下一棒待办（M4 可读性）

目标：**7 类可读性规则与 200 条人工标注 100% 一致**，并补齐每条规则的边界单测。

1. **7 类规则**（`src/core/rules/readability.js` + 注册进 `SOURCE_FILES`；口径在 `plan/03 §三` 与 §4.1–4.4）
   - `readability.cps` / `line-length` / `too-many-lines` / `too-few-chars` / `duration-short` / `duration-long` / `repeated-text`。
   - **单位口径（M1 定稿）**：`line.maxWidthFull`/`Half` 的口径单位是"该档字符数"，折成千分字符才是 milli 上限
     （全/日 ×1000、英 ×500）；可见字符计数先剥离 `{...}` / `<...>` / SDH 标记，再去空白换行。
   - **只读 ruleset 键，不写阈值字面量**（口径门会红）。`src/core/**` 保持纯函数（K2）。
2. **独立判定式**：`tools/samples/readabilityoracle.mjs` 已有 `READABILITY_RULES`；实现与它构成差分对照（K13）。
   200 条标注真值 `data/truth/readability/*.json` 的 `expectFindings` 是契约（每条 cue 的**全部**规则输出）。
3. **语言档**：按 cue 的主导文字类别选 `cps.zh` / `cps.en` / `cps.ja`；报告标注实际档位。
4. **边界单测**：每条规则四个边界值（上限、上限 + 1、下限、下限 − 1）各一条（`tests/readability_*.test.mjs`）。
5. **误报对照**：可读性的 `planted[]` 已给"干净孪生"；断言孪生不报该规则。
6. **端到端 0 容差**：把 `tests/samples_generator.test.mjs` 的可读性断言从"真值已落库"收紧为
   "pipeline 输出与 200 条 `expectFindings` 逐条相等"。
7. **收尾**：写 `plan/HANDOFF-M5.md`；回写三处状态副本（`plan/00` / `plan/05` / `README`）；
   把 `plan/06` 的 G03 判据改为"已达成 + 证据位置"。

## 三、既定口径清单（K 编号，动了会打挂测试）

- **K1**：阈值只在 `data/README.md` §4；`data/ruleset.v1.json` 是其镜像，由 `check-ruleset` 强制一致，**必须同提交修改**。
- **K2**：`src/core/**` 纯函数——不碰 DOM、不发网络、不读时钟、不读 locale、不用 `Math.random`。
- **K3**：`src/ui/**` 只消费 `core/pipeline`，不实现判定、不写阈值、不直接依赖 `core/rules/**`。
- **K4**：构建与测试共用 `tools/bundle.mjs` 的 `SOURCE_FILES`；清单必须等于 `src/**/*.js` 实际集合（**新增文件必须同步**）。
- **K5**：报告无时间戳 / 随机 ID / 本机路径；findings 按 `(line, ruleId)` 排序；键序固定。
- **K6**：单文件产物零外链、零网络调用。
- **K7**：未实现能力必须进 `skipped[]` 与 `capabilities`，不得静默返回空。**M4 实现可读性后必须撤下它的 `not_implemented` 声明**（`src/core/pipeline.js` 一处）。
- **K8**：状态副本 3 处（`plan/00` / `plan/05` / `README`）逐处一致。
- **K9**：收尾必须写下一棒交接单（布局门断言"下一待办里程碑的 HANDOFF 已落盘"）。
- **K10**：测试文件必须逐项列进 `package.json` 的 `test` 脚本。
- **K11**：真值只存输入与期望——`expectFindings` 只允许 `ruleId`/`line`/`field`；不得把 `observed` 写进真值。
- **K12**：`data/samples/**` 与 `data/truth/**` 是**字节即口径**（CRLF/BOM/GBK），`.gitattributes` 已声明 `-text`。
- **K13**：标注器（`tools/samples/*oracle.mjs`）**不得 import `src/core/**`**——它与实现必须互为差分对照。
- **K14**：解析层输出的**诊断码**（`parse.*`）也是 0 容差契约的一部分。
- **K15（M3 新增）**：`timing.*` 属**时间类** finding，`line` 取 `timeLine`；`readability.*` / `hygiene.*` 属**文本类**，
  `line` 取 `sourceLine`（依 plan/02 §3.1）。可读性真值里两条行号都给出，便于 M4 对账。

## 四、本机环境坑（只写实测过的）

- Node `v24.15.0`；`TextDecoder('gbk')` 可用。本机 Windows + Git Bash：临时目录用 `os.tmpdir()`。
- 改 `src/**` 后**必须** `node tools/build.mjs`（产物入仓），否则 `build.mjs --check` 与 `tests/artifact_e2e.test.mjs` 会红。
- `tests/artifact_e2e.test.mjs` 跑在**产物脚本**上（`node:vm` 新 realm），跨 realm 对象原型不同——比对象用 `JSON.stringify` 往返。
- 布局门的 GAPS 检查按**表头定位「缺口」列**并扫描该列：`plan/06` 里任何含「缺口」表头的表，
  其「缺口」列单元格**不得出现已 ✅ 的里程碑号**（`M0`/`M1`/`M2`/`M3`…）。M3 收尾时已把评分对标表的
  "M3–M5 待完成" 改成 "M4–M5"。
- **`git commit` 边界**：M3 的提交建议一次含 `src/core/rules/**`、`src/core/pipeline.js`、`src/ui/**`、`tools/bundle.mjs`、
  `tools/samples/**`、`tools/gen-samples.mjs`、`tests/**`、`package.json`、`data/**`、`dist/subtitle-preflight.html`
  与 `plan/**`、`README.md`。
- 远端**未建**：任何"CI 绿"必须写成"本地等价校验（未接远端，CI 待首推验证）"。

## 五、DoD 逐项 checklist（M4）

- [ ] 7 类可读性规则实现：200 条标注 cue 端到端与 `expectFindings` 0 容差
- [ ] 单位口径（千分字符 / 行长 milli 换算）与 `data/truth/README.md` §2.5 一致
- [ ] 每条规则四个边界值（上限、上限 + 1、下限、下限 − 1）各一条单测
- [ ] 语言档切换后结果变化且报告标注档位（中/英/日）
- [ ] 干净孪生不报该规则（误报对照）
- [ ] 实现后撤下 `capabilities.rules.readability` 的 `not_implemented`
- [ ] 新增测试文件逐项列入 `package.json` 的 `test`
- [ ] `npm test` 全绿；`node tools/build.mjs --check` 绿（产物已重建）
- [ ] `node tools/gen-samples.mjs --check` 绿；`node tools/check-truth.mjs` 绿
- [ ] `node tools/check-sprint-layout.mjs` 绿；`node tools/check-ruleset.mjs` 绿；`node tools/selftest-layout.mjs` 绿
- [ ] `node tools/e2e-browser.mjs` 全绿（缺浏览器时 exit 3 记"环境缺失"，不记通过）
- [ ] `plan/HANDOFF-M5.md` 已落盘；三处状态副本已回写；`plan/06` 缺口表 G03 改为已达成

## 六、关键命令速查

```bash
node tools/check-sprint-layout.mjs     # 布局门（第一件事）
node tools/check-ruleset.mjs           # 口径门
node tools/check-truth.mjs             # 真值门（样本 ↔ 真值 / 覆盖度 / 内容白名单）
node tools/gen-samples.mjs --check     # 样本与真值位级一致 + 无孤儿
node tools/selftest-layout.mjs         # 布局门 7 组变异自检
npm test                               # 全量测试（M3 后 13 个文件 / 149 项）
node tools/build.mjs                   # 构建单文件产物（改 src 后必须跑）
node tools/build.mjs --check           # 产物与源码同基线
node tools/e2e-browser.mjs             # 浏览器 e2e（需本机 Chrome/Edge；缺则 exit 3）
npm run verify                         # 三道门 + 生成器位级检查 + 测试 + 构建检查
```
