# HANDOFF-M6 · 下一棒 = 发布（tag + Release 附产物 + 发布留档 + CI 首推）

> 用法（相对路径）：本文件 `plan/HANDOFF-M6.md`。新对话启动时由用户侧拼绝对路径。
> 第一动作：`node tools/check-sprint-layout.mjs`（红了先修布局，再干活），随后 `node tools/check-ruleset.mjs`。

## 一、当前进度 + 证据

M0（装订）、M1（数据先行）、M2（解析）、M3（时序）、M4（可读性）、**M5（卫生与报告）已完成**。
四类规则至此**全部实现**，`capabilities` 全为 `implemented`。

| 产物 | 位置 | 证据（命令 / 结果） |
|---|---|---|
| 10 类卫生规则 | `src/core/rules/hygiene.js` | S01–S10 全实现；阈值与白名单全读 ruleset；30 条 golden set **precision 100% / recall 100%** |
| 白名单命中计数 | `src/core/report.js` 的 `summarizeWhitelist` | `summary.whitelist`（键按字典序，未命中不出现）；界面「白名单命中」折叠区；e2e 断言该区可见 |
| 三格式报告同源 | `src/core/report.js` 的 `toMarkdown` / `toCsv` | 与 JSON 共用同一份 findings 数组；条目数 + `ruleId`/`line` 逐条一致；CSV 按 RFC 4180 转义（测试侧独立解析器反向验证） |
| 可逆修复 | `src/core/fix.js` | 6 类动作（去重叠 / 修间隔 / 序号重编 / 去行尾空白 / 闭合标签 / 统一换行）；可修样本 `after < before` 且每条规则不增加；不可修样本 `after === before` 且 `fixes[]` 为空 |
| 修复护栏 | 同上 | 缩短 `end` 到 `后一条 start − timing.gapMin`（一次消两条规则），且缩短后时长 ≥ `duration.min`；不满足宁可不修 |
| 性能实测 | `tools/bench.mjs` | 本机 Node `v24.15.0`：样本 10558893 bytes / 5000 cue，5 轮 **min 1102.4ms / 中位 1242.9ms / max 1400.7ms**；对照 `perf.targetWallMs=2000` 达标 |
| 能力声明翻转 | `src/core/pipeline.js` | `rules.hygiene` / `exports.markdown` / `exports.csv` / `fixes` 全部 `implemented`；`skipped[]` 里不再有 `not_implemented` |
| 界面 | `src/ui/app.js` + `src/ui/index.html` | MD/CSV/修复按钮从置灰改为可用；新增 capabilities / fixes / whitelist 三个折叠区 |
| 新测试 | 4 份 | `tests/hygiene_golden.test.mjs` / `report_formats.test.mjs` / `fix_monotonic.test.mjs` / `bench_contract.test.mjs` |
| 测试总量 | `npm test` | **240 项全绿**（20 个测试文件；M4 后 201 项） |
| 产物 | `dist/subtitle-preflight.html` | `node tools/build.mjs --check` 绿（**108248 bytes**；sha256 `67842336275ab28456d056fdcf8db078631f67d2d26ea1a8a1328c68a2e58234`） |
| 门 | 布局 / 口径 / 真值 / 变异自检 / 生成器 | 全绿（`gen-samples --check` 85/85 逐字节一致；真值门 42↔42、109 期望项） |
| 浏览器 e2e | `tools/e2e-browser.mjs` | **11 项全绿**（新增：能力声明逐条摊开 / 修复区 / 白名单命中区 / MD+CSV+修复按钮全部可用） |
| 技术报告 | `docs/技术报告.md` | 落盘：架构 / 四类规则 / 差分对照 / 门禁 / 非目标 / **实测记录 §7** |
| README | `README.md` | 落盘：状态行翻 ✅、三格式报告、修复白名单、**性能实测表**、已知限制重写 |

> **本机实测**：Node `v24.15.0`，Windows + Git Bash。CI 未接远端，任何"CI 绿"必须写成
> "本地等价校验（未接远端，CI 待首推验证）"。

## 二、下一棒待办（M6 发布）

目标：**tag + GitHub Release 附产物 + `plan/RELEASE-M6.md` 两栏留档 + CI 首推验证**。

1. **定版**：产物内版本号、README、tag 名、Release 名**四处一致**；定版后立刻复跑全量测试。
2. **构建**：`node tools/build.mjs` → `--check` → 双跑 `cmp` 逐字节一致。
3. **tag**：annotated `git tag v0.1.0`；本地 `git rev-parse v0.1.0` 必须等于远端
   `git/ref/tags/v0.1.0` 的 `object.sha`。
4. **附件**：`dist/subtitle-preflight.html`（构建产物本身）+ 确定性源码包
   （`git archive --format=tar --prefix=subtitle-preflight-0.1.0/ v0.1.0 | gzip -9n`，**从 tag 构建**）。
5. **Release**：正文写 sha256（**不写进包内文档**）；`isDraft=false` 且附件 `state=uploaded`。
6. **留档**：`plan/RELEASE-M6.md` 两栏（tag 前事实 / tag 后追加）+ 阶段 7 覆盖对账表
   （逐条：实现 / 不适用 + 理由 / 待首推）。**tag 之后只允许文档面提交**
   （`git diff --name-only v0.1.0..HEAD` 只含 `plan/`、`README.md`）。
7. **CI 首推**：push 数 = run 数对账（按事件计数，tag run 也须绿）；四矩阵
   （ubuntu/windows × node 20/24）。浏览器 e2e 在 runner 上若缺 Chrome/Edge 会 exit 3
   → CI 里记"环境缺失"（**不是通过**）。
8. **脱敏四步** + 提交身份 / tagger 邮箱检查。
9. **收尾**：回写三处状态副本（`plan/00` / `plan/05` / `README`）；写 `plan/HANDOFF-M7.md`
   （若还有下一棒）或按方法论声明收尾；`plan/06` 的 G09/G10 改为"已达成 + 证据位置"。

## 三、既定口径清单（K 编号，动了会打挂测试）

- **K1**：阈值只在 `data/README.md` §4；`data/ruleset.v1.json` 是其镜像，由 `check-ruleset` 强制一致，**必须同提交修改**。
- **K2**：`src/core/**` 纯函数——不碰 DOM、不发网络、不读时钟、不读 locale、不用 `Math.random`。
- **K3**：`src/ui/**` 只消费 `core/pipeline`，不实现判定、不写阈值、不直接依赖 `core/rules/**`。
- **K4**：构建与测试共用 `tools/bundle.mjs` 的 `SOURCE_FILES`；清单必须等于 `src/**/*.js` 实际集合（**新增文件必须同步**；M5 新增 `rules/hygiene.js` 与 `fix.js` 已登记）。
- **K5**：报告无时间戳 / 随机 ID / 本机路径；findings 按 `(line, ruleId)` 排序；键序固定。
- **K6**：单文件产物零外链、零网络调用。
- **K7**：未实现能力必须进 `skipped[]` 与 `capabilities`，不得静默返回空。**M5 后已无 `not_implemented`**；`skipped[]` 里的 `fix` 记录语义是**执行结果**（`applied` / `no_fixable_finding`），不是"未实现"。
- **K8**：状态副本 3 处（`plan/00` / `plan/05` / `README`）逐处一致。
- **K9**：收尾必须写下一棒交接单（布局门断言"下一待办里程碑的 HANDOFF 已落盘"）。
- **K10**：测试文件必须逐项列进 `package.json` 的 `test` 脚本（当前 20 个文件）。
- **K11**：真值只存输入与期望——`expectFindings` 只允许 `ruleId`/`line`/`field`；不得把 `observed` 写进真值。
- **K12**：`data/samples/**` 与 `data/truth/**` 是**字节即口径**（CRLF/BOM/GBK），`.gitattributes` 已声明 `-text`。
- **K13**：标注器（`tools/samples/*oracle.mjs`）**不得 import `src/core/**`**——它与实现必须互为差分对照。
- **K14**：解析层输出的**诊断码**（`parse.*`）也是 0 容差契约的一部分。
- **K15**：`timing.*` 属**时间类** finding，`line` 取 `timeLine`；`readability.*` / `hygiene.*` 属**文本类**，`line` 取 `sourceLine`。
- **K16**：T11 fps 漂移拟合的判据是**残余漂移** `|scale−1| × 跨度 > drift.residualMaxMs`，并以 `drift.gridToleranceMs` 作护栏；未声明帧率 → `skipped(media_fps_unknown)`。
- **K17**：finding 严格保持 `plan/02 §3.2` 的 **7 键**（`ruleId/severity/line/field/expected/actual/message`）；语言档位写进 `expected`/`message` 文案，**不新增键**。
- **K18**：时序与可读性真值的端到端对账**按域切分**——时序测试只比 `timing.*`，可读性只比 `readability.*`，卫生只比 `hygiene.*`；多域在同一 cue 上并存，互不污染。
- **K19（M5 新增）**：卫生 finding 的 `line` 取 `sourceLine`，且**同 cue 同 ruleId 只报一条**（逐行报会在同一 `line` 上堆多条同 ruleId，既重复又难读）。真值按 cue 级标注。
- **K20（M5 新增）**：修复落在**原文行**上，不重新序列化格式——修复后文件与原文逐行同构（SRT/VTT/ASS 各自保持），时间码重写保留原行分隔符与小数位数；找不到两个时间码 token 时宁可不修。
- **K21（M5 新增）**：`summary` 键序固定为 `total → bySeverity → byRule → whitelist`；白名单命中**不是违规**，不进 `findings[]`。
- **K22（M5 新增）**：`tools/bench.mjs` 只测量、**不判达标**；`perf.targetWallMs` 是设计口径，不是硬承诺（不同机器不可比）。脚本形态由 `tests/bench_contract.test.mjs` 锁。

## 四、本机环境坑（只写实测过的）

- Node `v24.15.0`；`TextDecoder('gbk')` 可用。本机 Windows + Git Bash：临时目录用 `os.tmpdir()`。
- 改 `src/**` 后**必须** `node tools/build.mjs`（产物入仓），否则 `build.mjs --check` 与 `tests/artifact_e2e.test.mjs` 会红。
- `tests/artifact_e2e.test.mjs` 跑在**产物脚本**上（`node:vm` 新 realm），跨 realm 对象原型不同——比对象用 `JSON.stringify` 往返。
- 布局门的 GAPS 检查按**表头定位「缺口」列**并扫描该列：`plan/06` 里任何含「缺口」表头的表，
  其「缺口」列单元格**不得出现已 ✅ 的里程碑号**（现在含 `M0`…`M5`）。M5 收尾时已把评分对标表的
  "M5 待完成" 改成 "无（M5 已补齐）"，G04–G08 改成 "**已达成**：…"。
- **口径门的字面量扫描**会拒绝 `src/**` 里出现区分性阈值（如 `7000`/`800`/`42`/`16`/`17`/`20`）。
  卫生实现里读的是 ruleset 键，未引入新字面量（`hygiene.js` 里没有 `20`/`3` 的裸数字）。
- **`core/fix.js` 的修复顺序有语义**：去行尾空白**必须**排在补闭合标签之前
  （否则空白被"锁"在标签内侧）；缩短时间码的目标是 `后一条 start − timing.gapMin`，
  不是"后一条 start"（否则立刻产生 `gap-too-small`）。两处都有测试锁。
- `tools/bench.mjs` 跑默认样本时会在 `out/` 写 10MB 文件（**不入仓**，`.gitignore` 已覆盖）；
  测试用 `--sample` 换小样本，**不要**在 CI 里跑默认样本（10MB 生成 + 5 轮计时太慢）。
- **`git commit` 边界**：M6 的提交含 `plan/**`、`README.md`、`docs/**`（若 tag 前）；
  **tag 之后**只允许 `plan/`、`README.md` 的文档面提交。
- 远端**未建**：任何"CI 绿"必须写成"本地等价校验（未接远端，CI 待首推验证）"。

## 五、DoD 逐项 checklist（M6）

- [ ] 定版：产物内版本号 / README / tag 名 / Release 名**四处一致**；定版后复跑全量测试
- [ ] `node tools/build.mjs` → `--check` → 双跑 `cmp` 逐字节一致
- [ ] `git tag v0.1.0`（annotated）；本地 `rev-parse` == 远端 `object.sha`
- [ ] Release 附 `dist/subtitle-preflight.html` + 确定性源码包（**从 tag 构建**）
- [ ] 正文写 sha256（**不写进包内文档**）；`isDraft=false`；附件 `state=uploaded`
- [ ] `plan/RELEASE-M6.md` 两栏 + 阶段 7 覆盖对账表（逐条：实现 / 不适用 + 理由 / 待首推）
- [ ] tag 后 `git diff --name-only v0.1.0..HEAD` 只含 `plan/`、`README.md`
- [ ] CI 首推：push 数 = run 数对账；四矩阵（ubuntu/windows × node 20/24）绿
- [ ] 浏览器 e2e 在 runner 上缺浏览器时记"环境缺失"（exit 3），**不记通过**
- [ ] 脱敏四步 + 提交身份 / tagger 邮箱检查
- [ ] `node tools/check-sprint-layout.mjs` 绿；`node tools/check-ruleset.mjs` 绿；`node tools/check-truth.mjs` 绿；`node tools/selftest-layout.mjs` 绿
- [ ] `npm test` 全绿；`node tools/build.mjs --check` 绿；`node tools/gen-samples.mjs --check` 绿
- [ ] 三处状态副本已回写（M6 ✅）；`plan/06` 的 G09/G10 改为已达成

## 六、关键命令速查

```bash
node tools/check-sprint-layout.mjs     # 布局门（第一件事）
node tools/check-ruleset.mjs           # 口径门
node tools/check-truth.mjs             # 真值门（样本 ↔ 真值 / 覆盖度 / 内容白名单）
node tools/gen-samples.mjs --check     # 样本与真值位级一致 + 无孤儿
node tools/gen-samples.mjs --perf      # 10MB / 5000 cue 性能样本 → out/（不入仓）
node tools/bench.mjs --runs 5          # 性能基准（只测量、不判达标）
node tools/selftest-layout.mjs         # 布局门 7 组变异自检
npm test                               # 全量测试（M5 后 20 个文件 / 240 项）
node tools/build.mjs                   # 构建单文件产物（改 src 后必须跑）
node tools/build.mjs --check           # 产物与源码同基线
node tools/e2e-browser.mjs             # 浏览器 e2e（需本机 Chrome/Edge；缺则 exit 3）
npm run verify                         # 三道门 + 生成器位级检查 + 测试 + 构建检查
```
