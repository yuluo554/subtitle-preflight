# HANDOFF-M5 · 下一棒 = 卫生与报告（10 类卫生 + 三格式报告 + 可逆修复 + 性能实测）

> 用法（相对路径）：本文件 `plan/HANDOFF-M5.md`。新对话启动时由用户侧拼绝对路径。
> 第一动作：`node tools/check-sprint-layout.mjs`（红了先修布局，再干活），随后 `node tools/check-ruleset.mjs`。

## 一、当前进度 + 证据

M0（装订）、M1（数据先行）、M2（解析）、M3（时序）、**M4（可读性）已完成并提交**。

| 产物 | 位置 | 证据（命令 / 结果） |
|---|---|---|
| 7 类可读性规则 | `src/core/rules/readability.js` | R01–R07 全类 `implemented`；200 条标注 cue 端到端 **0 容差**（`tests/samples_generator.test.mjs`） |
| 定点千分字符度量 | 同上 | 全角 1000 / 半角 500；可见字符先剥离 `{...}` / `<...>` / `[..]` / `（..）` / `♪`，再去空白换行 |
| 行长单位换算 | 同上 | 中/日上限 = `line.maxWidthFull × 1000`（16→16000）；英 = `line.maxWidthHalf × 500`（42→21000）；与 `data/truth/README.md` §2.5 一致 |
| 语言档判定 | 同上 | `dominantLang`：全角=0→en；假名×2 ≥ 全角→ja；全角 ≥ 半角→zh；否则 en；finding 的 `expected`/`message` 标注档位 |
| 边界单测 | `tests/readability_cps.test.mjs` + `readability_line.test.mjs` + `readability_chars_duration.test.mjs` | 每规则四个边界值（上限 / 上限+1 / 下限 / 下限−1）各一条；**50 项**全绿 |
| 误报对照（干净孪生） | `data/truth/readability/*.json` 的 `planted[]` | 每条正例有非空 diff 的干净孪生，孪生在独立判定式下不复现该规则 |
| 独立判定式（真值侧） | `tools/samples/readabilityoracle.mjs` | **不 import src/core**（K13 差分对照）；200 条手写期望与它逐条对账 |
| 语言档三档实测 | `tests/samples_generator.test.mjs` | 报告 `expected`/`message` 里 zh / en / ja **三档都出现** |
| capabilities | `src/core/pipeline.js` | `rules.readability = "implemented"`；`skipped[]` 不再含 readability 域 |
| 新测试 | 3 份 `tests/readability_*.test.mjs` | `npm test` **201 项全绿**（M3 后 149 项） |
| 产物 | `dist/subtitle-preflight.html` | `node tools/build.mjs --check` 绿（74073 bytes） |
| 门 | 布局 / 口径 / 真值 / 变异自检 / 生成器 | 全绿（`gen-samples --check` 85/85 逐字节一致） |
| 浏览器 e2e | `tools/e2e-browser.mjs` | 7 项全绿（boot / 零外网 / 粘贴解析 / 渲染 / 未执行检查区 / 导出接线） |

> **本机实测**：Node `v24.15.0`。CI 未接远端，任何"CI 绿"必须写成"本地等价校验（未接远端，CI 待首推验证）"。

## 二、下一棒待办（M5 卫生与报告）

目标：**10 类卫生规则 precision 100% / recall ≥ 90%** + 三格式报告（JSON/MD/CSV 同源）+ 可逆修复（违规数单调下降）+ 10MB/5000 cue 性能实测回填 + `docs/技术报告.md`。

1. **10 类卫生规则**（`src/core/rules/hygiene.js` + 注册进 `SOURCE_FILES`；口径在 `plan/03 §四`）
   - S01–S10（`hygiene.cjk-latin-spacing` … `hygiene.repeated-punctuation`）。
   - **白名单**：`data/ruleset.v1.json` 的 `hygiene.whitelist`；命中次数进报告（不得静默）。
   - `hygiene.*` 属**文本类** finding，`line` 取 `sourceLine`（K15）。
   - 只读 ruleset 键，不写阈值字面量（口径门会红）。`src/core/**` 保持纯函数（K2）。
2. **独立判定式**：`tools/samples/hygieneoracle.mjs` 已有 `HYGIENE_RULES`；实现与它构成差分对照（K13）。
   30 条 golden set 真值 `data/truth/hygiene/hygiene-golden.json` 的逐条 `expectFindings` 是契约。
3. **三格式报告**：Markdown / CSV 与 JSON **共用同一份 findings 数组**（单一渲染源）；测试断言
   "条目数相同 + 每条的 ruleId/line 一致"；CSV 按 RFC 4180 转义。
4. **可逆修复**：`fixes[]` + 导出新文件；修复后重跑规则，**违规数单调下降**（`after <= before` 且存在可修项时 `after < before`）；
   "不可修样本"断言 `after === before` 且 `fixes[]` 为空。
5. **性能实测**：`node tools/gen-samples.mjs --perf` → `out/`（不入仓），实测 10MB/5000 cue 全流程耗时，
   结果**回填** `plan/RELEASE-M6.md` 与技术报告，**不写死承诺**。
6. **界面补齐**：MD/CSV/修复按钮从置灰改为可用；"未执行检查"折叠区仍渲染 `skipped[]` 与 `capabilities`。
7. **收尾**：写 `plan/HANDOFF-M6.md`；回写三处状态副本（`plan/00` / `plan/05` / `README`）；
   把 `plan/06` 的 G04–G08 判据改为"已达成 + 证据位置"；撤下 `capabilities.rules.hygiene` 的 `not_implemented`（`src/core/pipeline.js` 一处）。

## 三、既定口径清单（K 编号，动了会打挂测试）

- **K1**：阈值只在 `data/README.md` §4；`data/ruleset.v1.json` 是其镜像，由 `check-ruleset` 强制一致，**必须同提交修改**。
- **K2**：`src/core/**` 纯函数——不碰 DOM、不发网络、不读时钟、不读 locale、不用 `Math.random`。
- **K3**：`src/ui/**` 只消费 `core/pipeline`，不实现判定、不写阈值、不直接依赖 `core/rules/**`。
- **K4**：构建与测试共用 `tools/bundle.mjs` 的 `SOURCE_FILES`；清单必须等于 `src/**/*.js` 实际集合（**新增文件必须同步**）。
- **K5**：报告无时间戳 / 随机 ID / 本机路径；findings 按 `(line, ruleId)` 排序；键序固定。
- **K6**：单文件产物零外链、零网络调用。
- **K7**：未实现能力必须进 `skipped[]` 与 `capabilities`，不得静默返回空。**M5 实现卫生后必须撤下它的 `not_implemented` 声明**（`src/core/pipeline.js` 一处）。
- **K8**：状态副本 3 处（`plan/00` / `plan/05` / `README`）逐处一致。
- **K9**：收尾必须写下一棒交接单（布局门断言"下一待办里程碑的 HANDOFF 已落盘"）。
- **K10**：测试文件必须逐项列进 `package.json` 的 `test` 脚本。
- **K11**：真值只存输入与期望——`expectFindings` 只允许 `ruleId`/`line`/`field`；不得把 `observed` 写进真值。
- **K12**：`data/samples/**` 与 `data/truth/**` 是**字节即口径**（CRLF/BOM/GBK），`.gitattributes` 已声明 `-text`。
- **K13**：标注器（`tools/samples/*oracle.mjs`）**不得 import `src/core/**`**——它与实现必须互为差分对照。
- **K14**：解析层输出的**诊断码**（`parse.*`）也是 0 容差契约的一部分。
- **K15**：`timing.*` 属**时间类** finding，`line` 取 `timeLine`；`readability.*` / `hygiene.*` 属**文本类**，`line` 取 `sourceLine`。
- **K16**：T11 fps 漂移拟合的判据是**残余漂移** `|scale−1| × 跨度 > drift.residualMaxMs`，并以 `drift.gridToleranceMs` 作护栏；未声明帧率 → `skipped(media_fps_unknown)`。
- **K17（M4 新增）**：finding 严格保持 `plan/02 §3.2` 的 **7 键**（`ruleId/severity/line/field/expected/actual/message`）；
  可读性的语言档位写进 `expected`/`message` 文案，**不新增键**（避免数据契约漂移）。
- **K18（M4 新增）**：时序真值与可读性真值的端到端对账**按域切分**——时序测试只比 `timing.*`，可读性测试只比 `readability.*`；
  两域在同一 cue 上并存（如 T02 的 0ms cue 也会触发 `readability.duration-short`），互不污染。

## 四、本机环境坑（只写实测过的）

- Node `v24.15.0`；`TextDecoder('gbk')` 可用。本机 Windows + Git Bash：临时目录用 `os.tmpdir()`。
- 改 `src/**` 后**必须** `node tools/build.mjs`（产物入仓），否则 `build.mjs --check` 与 `tests/artifact_e2e.test.mjs` 会红。
- `tests/artifact_e2e.test.mjs` 跑在**产物脚本**上（`node:vm` 新 realm），跨 realm 对象原型不同——比对象用 `JSON.stringify` 往返。
- 布局门的 GAPS 检查按**表头定位「缺口」列**并扫描该列：`plan/06` 里任何含「缺口」表头的表，
  其「缺口」列单元格**不得出现已 ✅ 的里程碑号**（`M0`…`M4`）。M4 收尾时已把评分对标表的 "M4–M5 待完成" 改成 "M5 待完成"。
- **口径门的字面量扫描**会拒绝 `src/**` 里出现区分性阈值（如 `7000`/`800`/`42`/`16`/`17`）。
  可读性实现里用的是**换算基数** 1000/500（非阈值），已实测不被判红；M5 若引入新常量需同样复核。
- **`git commit` 边界**：M5 的提交建议一次含 `src/core/rules/**`、`src/core/pipeline.js`、`src/ui/**`、`tools/bundle.mjs`、
  `tools/samples/**`、`tools/gen-samples.mjs`、`tests/**`、`package.json`、`data/**`、`dist/subtitle-preflight.html`
  与 `plan/**`、`README.md`、`docs/**`。
- 远端**未建**：任何"CI 绿"必须写成"本地等价校验（未接远端，CI 待首推验证）"。

## 五、DoD 逐项 checklist（M5）

- [ ] 10 类卫生规则实现：30 条 golden set precision 100% / recall ≥ 90%
- [ ] 白名单命中计数进报告（不得静默）
- [ ] Markdown / CSV 与 JSON 同源（条目数 + ruleId/line 逐条一致）；CSV 按 RFC 4180 转义
- [ ] 可逆修复：违规数单调下降；不可修样本 `after === before` 且 `fixes[]` 为空
- [ ] 10MB / 5000 cue 性能实测回填（不写死承诺）
- [ ] 实现后撤下 `capabilities.rules.hygiene` 的 `not_implemented`
- [ ] 新增测试文件逐项列入 `package.json` 的 `test`
- [ ] `npm test` 全绿；`node tools/build.mjs --check` 绿（产物已重建）
- [ ] `node tools/gen-samples.mjs --check` 绿；`node tools/check-truth.mjs` 绿
- [ ] `node tools/check-sprint-layout.mjs` 绿；`node tools/check-ruleset.mjs` 绿；`node tools/selftest-layout.mjs` 绿
- [ ] `node tools/e2e-browser.mjs` 全绿（缺浏览器时 exit 3 记"环境缺失"，不记通过）
- [ ] `README.md` 与 `docs/技术报告.md` 落盘
- [ ] `plan/HANDOFF-M6.md` 已落盘；三处状态副本已回写；`plan/06` 缺口表 G04–G08 改为已达成

## 六、关键命令速查

```bash
node tools/check-sprint-layout.mjs     # 布局门（第一件事）
node tools/check-ruleset.mjs           # 口径门
node tools/check-truth.mjs             # 真值门（样本 ↔ 真值 / 覆盖度 / 内容白名单）
node tools/gen-samples.mjs --check     # 样本与真值位级一致 + 无孤儿
node tools/gen-samples.mjs --perf      # 10MB / 5000 cue 性能样本 → out/（不入仓）
node tools/selftest-layout.mjs         # 布局门 7 组变异自检
npm test                               # 全量测试（M4 后 16 个文件 / 201 项）
node tools/build.mjs                   # 构建单文件产物（改 src 后必须跑）
node tools/build.mjs --check           # 产物与源码同基线
node tools/e2e-browser.mjs             # 浏览器 e2e（需本机 Chrome/Edge；缺则 exit 3）
npm run verify                         # 三道门 + 生成器位级检查 + 测试 + 构建检查
```
