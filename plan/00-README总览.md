# 00 · README 总览 — 10-19-subtitle-preflight（字幕投放前体检）

> 方法论：`ai-tool-project-sprint`（装订 2026-10-18）｜布局门：`node tools/check-sprint-layout.mjs`｜续接对话第一件事 = 跑它

- 性质：不参赛项目题 · 发布 GitHub **公开仓库** · 署名 yuluo554
- 交付形态（唯一）：**单文件 HTML 本地 Web 应用**（零安装、零后端、零 CDN、断网可用，双击打开即用）
- 定位宣言："把 `.srt/.vtt/.ass` 拖进一个 HTML 文件，浏览器内解析，按「时序 / 阅读速度 / 行长 / 排版卫生」四类确定性规则体检，输出带源文件行号定位的 JSON/Markdown 报告 + 只做可逆修复的字幕文件。零安装、零上传、断网可用——现有字幕工具要么是 C# 桌面巨兽（SubtitleEdit 14603★），要么是 0–3 星一次性脚本。"
- 基准日：**2026-10-17**；GitHub 检索实测窗口 **2026-10-18 10:33–10:45 UTC**（跨日不足 1 天，`data/README.md` 已如实标注）
- 当前状态：**M2 已完成**（三格式解析器 + 24 份样本 0 容差 + 行号映射 + G11/G12/G13 落定），下一棒 **M3 时序**

## 一、文档索引表

| 文档 | 内容 | 状态 |
|---|---|---|
| `plan/00-README总览.md` | 本文档：索引 / 决策记录 / 承诺-证据台账 / 招牌动词表 / 提交材料实物表 / 里程碑 | ✅ v2 |
| `plan/01-题目文档.md` | 十段式题目定稿（介绍 / 五模块 / 提交材料 / 评分 / 锚点 / 边界） | ✅ v1 |
| `plan/02-架构与技术选型.md` | 分层、模块边界、构建链路、数据契约、错误降级、确定性设计 | ✅ v1 |
| `plan/03-模块详设.md` | 五模块的输入/输出/算法/误报控制/验收 | ✅ v1 |
| `plan/04-数据计划.md` | 样本清单、真值结构、真值纪律、数据落库节奏 | ✅ v1 |
| `plan/05-里程碑与发布.md` | 逐里程碑 DoD、发布流程、状态表、已知未验证项、风险登记 | ✅ v1 |
| `plan/06-交付对标与决策.md` | 评分对标、招牌动词兑现、缺口表、决策记录 | ✅ v1 |
| `plan/HANDOFF-M1.md` | 第 1 棒交接单（六节齐） | ✅ |
| `plan/HANDOFF-M2.md` | 第 2 棒交接单（六节齐） | ✅ |
| `plan/HANDOFF-M3.md` | 下一棒交接单（六节齐） | ✅ |
| `data/README.md` | 依据查证三态 + 数据源可获取性 + 合成数据纪律 + **数值口径单一真相源（§4）** | ✅ v2 |
| `data/ruleset.v1.json` | §4 的机器可读镜像（由 `check-ruleset` 强制一致） | ✅ |
| `data/samples/**` + `data/truth/**` | 42 份样本 + 42 份真值 + `coverage.json`（生成器派生） | ✅ M1 |
| `data/truth/README.md` | 标注准则 + 规则域清单（人类可读真源，被 `check-truth` 解析） | ✅ M1 |
| `tools/gen-samples.mjs` + `tools/samples/**` | 样本生成器 + 独立判定式标注器（不 import src/core） | ✅ M1 |
| `tools/check-truth.mjs` | 真值门：一一对应 / 禁观测字段 / 覆盖度 / 内容白名单 | ✅ M1 |
| `AGENTS.md` | 仓库锚点：方法论 / 布局门 / 强制布局 / K 口径 | ✅ |
| `README.md` | 面向使用者的产品页 | ✅ |
| `LICENSE` | MIT | ✅ |
| `.gitignore` / `.gitattributes` | 构建产物不入仓；源码与产物统一 LF | ✅ v2 |
| `plan/RELEASE-M6.md` | 发布留档（tag 时点事实 / 发布后追加事实分栏） | ⬜ 待 M6 |

## 二、决策记录表

> 含已定案决策与**弃选项**（弃选理由写死，后续里程碑不再重复论证）。

| 日期 | 决策 | 结论与理由 |
|---|---|---|
| 2026-10-17 | **形态收敛为单文件 HTML（唯一形态）** | 本题的价值主张是"把体检成本压到接近零"。CLI 要装 Python/Node，桌面 exe 要打包与信任二进制，本地服务要管端口。单文件 HTML 双击即用，且浏览器沙箱天然保证"文件不外传"。**不设第二形态**，避免"CLI 真做、界面空壳"的通行证。 |
| 2026-10-17 | 弃「HAR 脱敏」方向 | `cloudflare/har-sanitizer`（252★）与 `google/har-sanitizer`（75★）已占住核心心智，且两家的规则集持续维护；本题再做一个只会是第三份同类实现。 |
| 2026-10-17 | 弃「Excel 工作簿体检」方向 | `workbooklens`（142★，2026-08 建）正在快速吃同一心智；且要做公式体检必须自写 tokenizer，工作量与首期五模块冲突。 |
| 2026-10-17 | 弃「EPUB 体检」方向 | 必须自我设限为 `epubcheck` 的子集才有意义，而 ZIP + OPF + XHTML 三处都是硬骨头；做了也不如原工具完整，差异化讲不清。 |
| 2026-10-17 | 弃「播客 LUFS 响度体检」方向 | 已有浏览器内实现（`needles` 76★），形态优势被抵消；且 LUFS 需要音频解码与滤波，与"零依赖单文件"预算冲突。 |
| 2026-10-17 | 弃「ICS 日历校验」方向 | 需求证据弱：没有找到成规模的"日历文件导入后错乱"的真实讨论；规则也偏薄（换行折叠、时区、UID 唯一性），撑不起五模块。 |
| 2026-10-17 | **不做自动断句重排** | 断句依赖语义与语感，自动重排必然改文本语义；与"只做可逆无损修复"的红线直接冲突。V2EX 上"断句断得不好"的诉求真实存在，但那是翻译/润色工具的问题，不是投放前体检的问题。 |
| 2026-10-17 | **不做音频强制对齐** | 需要音频解码 + 声学模型（WASM + 权重），突破"单文件、断网、零依赖"的体积与离线预算；且结果不确定，无法给出确定性真值。 |
| 2026-10-17 | **不做平台规则库** | 各平台的隐式审核规则不公开、易过期、无法查证。内置等于把不可核验的传闻写成硬判定；改为提供可调的通用阈值档。 |
| 2026-10-17 | **报告默认无时间戳** | 确定性优先：同一输入两次导出必须 byte 级一致。需要时间信息时由用户在界面勾选，勾选后报告标注"非确定性导出"。 |
| 2026-10-17 | **数值口径单点定义在 `data/README.md` §4** | CPS、行长、时长、间隔、fps 网格、`ruleset_version` 全部只在 §4 出现一次；plan/01 §2 与代码只引用口径键，plan/01 中的数字是摘要，**修改必须先改 §4 并同提交同步**。 |
| 2026-10-17 | **检索数据定性为软论据（⬜）** | 10 条检索式与星数是带基准日的快照，不构成"业界首创"的硬证明；题面统一写"这一格是空的（软论据）"，不写"空白/首创"。 |

## 三、承诺-证据台账（全项目唯一一份）

> 其他文档只可引用，不得复制本表。状态列随里程碑同提交翻转。

| 承诺项 | 素材来源 | 交付物内可达性 | 核验方式 | 状态 |
|---|---|---|---|---|
| 三格式解析（SRT/VTT/ASS） | 自建 24 份样本（3 格式 × 8 变体） | 单文件内三个解析器，零外部依赖 | `data/truth/` 逐条标注 vs 解析输出，0 容差 | ✅ M2（24 份样本 cue 边界 / 行号 / 诊断码 全部 0 容差，`tests/samples_generator.test.mjs`） |
| 原文行号映射 | 同上（样本自带行号标注） | cue 模型的 `sourceLine`/`endLine` 字段 | 24 份样本行号误差 0 | ✅ M2（三格式 × 8 变体行号映射全部 0 容差） |
| 编码嗅探与 GBK 回退 | 自建 GBK 样本（3 份） | `TextDecoder('gbk')`，浏览器原生 | 中文逐字比对一致 + 界面标注回退 | 🟡 已实现并有测试；GBK 样本已落库（M1，字节经往返自证） |
| 12 类时序缺陷 | 自建 12 类缺陷样本 + 1 份干净基线 | 规则引擎 `timing.*` | 检出率 100% / 误报 0 | 🟡 M2 已让 11/12 类端到端 0 容差（含 T07 负起点）；T11 待 M3 |
| fps 漂移拟合 | 自建漂移样本（声明 fps） | 网格搜索 `timing.drift` | 复原误差 < 1 帧 + 双跑参数一致 | 🟡 样本已落库（scale≈1.0427）；规则待 M3 |
| CPS / 行长判定 | 200 条人工标注 cue | 规则引擎 `readability.*` | 与标注 100% 一致 + 边界单测 | 🟡 200 条标注已落库（M1）；规则待 M4 |
| 10 类卫生规则 | 30 条 golden set | 规则引擎 `hygiene.*` | precision 100% / recall ≥ 90% | 🟡 golden set 已落库（M1）；规则待 M5 |
| 行号定位的 finding | 行号映射表 | `findings[].line` | 每条 finding 可回到原文行 | ✅ M2（三格式解析出的 finding 均可回到原文行；`timing.*` 取 timeLine） |
| 基准样本与真值 | 自建合成样本（42 份） | `data/samples/**` + `data/truth/**` | `node tools/gen-samples.mjs --check` + `node tools/check-truth.mjs` | ✅ M1（85 文件位级一致；1 对 1 无孤儿；覆盖度全绿） |
| JSON/MD/CSV 三导出 | 报告模块 | 界面按钮，Blob 下载 | schema 校验 + byte 级双跑一致 | 🟡 JSON 已通；MD/CSV 待 M5 |
| 可逆修复 + diff | 修复白名单 | `fixes[]` + 导出新文件 | 重跑违规数严格单调下降 | ⬜ 待 M5 |
| 单文件产物 | `tools/build.mjs` 内联构建 | `dist/subtitle-preflight.html` | 零外链断言 + 断网打开 e2e | ✅ M0（`build.test` + `artifact_e2e`） |
| 零网络请求 | 形态本身 | 无 CDN/字体/遥测 | 静态扫描（无 `http(s)://`、无 `fetch`/`XHR`）+ 断网 e2e | ✅ M0（静态扫描 + headless e2e 实测 0 外网请求） |
| 性能口径（10MB/5000 cue） | 自建大样本 | 全流程计时 | 基准实测，结果以末态回填，不写死承诺 | ⬜ 待 M5 |

## 四、招牌动词表

| 能力名词 | 哪条交付态命令/操作产出它 | 哪条基准/测试断言它 |
|---|---|---|
| 解析（SRT） | 页面"拖入文件"/粘贴 → 文件卡片 | `tests/parse_srt.test.mjs`（8 类变体 + 行号映射） |
| 解析（VTT/ASS） | 同入口（拖入 / 粘贴 → 文件卡片） | `tests/parse_vtt.test.mjs` + `tests/parse_ass.test.mjs` + 16 份样本 0 容差 |
| 行号映射 | 结果区"第 N 行" | `tests/parse_srt.test.mjs`（sourceLine/timeLine/textLineNumbers） |
| 编码嗅探 | 文件卡片上的"GBK 回退"标注 | `tests/decode.test.mjs`（GBK 逐字一致 + fallback 标注） |
| 时序体检 | 页面"解析粘贴内容"/拖入 → 体检结果 | `tests/timing_rules.test.mjs`（T01–T10、T12 + 边界反例） |
| fps 漂移拟合 | 时序分组的"漂移诊断"卡片 | `tests/drift_fit.test.mjs`（M3 产出；当前 `skipped[]`） |
| 阅读速度（CPS） | 体检结果的"可读性"分组 | `tests/readability_cps.test.mjs`（M4 产出） |
| 行长 | 可读性分组（含实测值与阈值） | `tests/readability_line.test.mjs`（M4 产出） |
| 排版卫生 | 体检结果的"卫生"分组 | `tests/hygiene_golden.test.mjs`（M5 产出） |
| 行号定位 | 每条 finding 的"第 N 行"链接 | `tests/artifact_e2e.test.mjs`（渲染层行号列）+ `timing_rules` |
| JSON 报告 | 页面"导出 JSON" | `tests/report_determinism.test.mjs`（byte 级双跑 + 键序） |
| Markdown / CSV | 页面"导出"按钮（当前置灰） | `tests/report_determinism.test.mjs`（M5 补齐） |
| 可逆修复 | 页面"导出修复后字幕"（当前置灰） | `tests/fix_monotonic.test.mjs`（M5 产出） |
| 单文件产物 | `node tools/build.mjs` → `dist/subtitle-preflight.html` | `tests/build.test.mjs` + `tests/artifact_e2e.test.mjs` + `tools/e2e-browser.mjs` |

## 五、提交材料实物表（一物一证）

| 承诺项（plan/01 §3） | 应存在的文件路径 | 由哪个里程碑产出 | 用哪条命令核对 |
|---|---|---|---|
| 单文件产物 | `dist/subtitle-preflight.html` | M0 起持续构建，M5 定稿 | `node tools/build.mjs --check` + `ls dist/` |
| 源码与构建 | `src/`、`tools/build.mjs` | M0 起 | `git ls-files src tools` |
| 基准样本与真值 | `data/samples/`、`data/truth/` | M1 | `git ls-files data/samples data/truth` + `tools/check-truth.mjs` |
| README | `README.md` | M0 起持续更新 | `git ls-files README.md` |
| 技术报告 | `docs/技术报告.md` | M5 | `git ls-files docs` |
| 口径文档 | `data/README.md` | M0 | `git ls-files data/README.md` + `node tools/check-ruleset.mjs` |
| 测试与基准 | `tests/` | M0 起 | `npm test` |
| 发布留档 | `plan/RELEASE-M6.md` | M6 | `git cat-file -e <tag>:plan/RELEASE-M6.md` |

## 六、里程碑与 DoD

| 里程碑 | 内容 | DoD | 状态 |
|---|---|---|---|
| M0 装订与骨架 | 方法论装订 + `plan/02–06` + `src/` 分层骨架 + 单文件构建 + 两道门 + 测试 | 布局门/口径门/变异自检全绿；测试绿；`build --check` 绿 | ✅ |
| M1 数据先行 | 24 份格式变体 + 12 类时序缺陷样本 + 200 条可读性标注 cue + 30 条卫生 golden set，全部附真值 | 样本与真值入仓；`data/README.md` §4 口径表定稿；真值覆盖度按规则域逐项列全；样本全部为虚构内容 | ✅ |
| M2 解析 | 三格式解析器 + 行号映射 + 编码嗅探 | 24 份样本 cue 数与起止时间 0 容差；GBK 无乱码；行号误差 0 | ✅ |
| M3 时序 | 12 类时序规则 + fps 漂移拟合 | 检出率 100%/误报 0；漂移复原 < 1 帧；双跑参数完全一致 | ⬜ |
| M4 可读性 | CPS / 行长 / 行数 / 时长 / 重复文本 | 200 条标注 100% 一致；边界值单测覆盖；定点整数判定 | ⬜ |
| M5 卫生与报告 | 10 类卫生规则 + 三格式报告 + 可逆修复 + 单文件构建 | precision 100%/recall ≥ 90%；报告 byte 级双跑一致 + schema 通过；修复后违规数单调下降；单文件零外链、断网可跑；技术报告与 README 落盘 | ⬜ |
| M6 发布 | GitHub 公开仓库发布 | **① `git tag v0.1.0`；② GitHub Release 附产物**（`dist/subtitle-preflight.html` + 确定性源码包，本地留副本并记 sha256）；**③ 发布留档 `plan/RELEASE-M6.md`**（tag 时点事实 / 发布后追加事实分栏）；④ 布局门与口径门在 tag 树内全绿；⑤ CI 干净 clone 直跑通过 | ⬜ |

> DoD 口径写死为 **A) Release 附产物**（≥1 个手工上传附件）。里程碑表的 DoD 列**只能加不能减**；任何裁剪必须在 §二 决策记录留一行理由。

## 七、形态自查表（唯一形态）

| 形态 | 主入口 | 主控件/命令 | 接到哪个业务函数 | 断言在哪条测试 | 产物在哪个附件 |
|---|---|---|---|---|---|
| 单文件 HTML | 双击 `dist/subtitle-preflight.html` | 拖放区 / "体检" / "导出 JSON" / "导出修复后字幕" | `parseAll()` → `runRules()` → `renderReport()` / `applyFixes()` | `tests/artifact_e2e.test.mjs`（在**产物脚本**上跑）+ `tools/e2e-browser.mjs`（真实 headless Chrome 从产物文件打开→拖入→点击→读到结果） | Release 附件 `subtitle-preflight.html` |

> 任一行有空格 → 该形态视为未交付。

## 八、交接语（下一棒 = sprint M3）

题目已定稿于 `plan/01-题目文档.md`，口径单点定义在 `data/README.md` §4，架构与模块边界见 `plan/02`/`plan/03`。
M0 骨架、M1 基准与真值已落地。M2 已把**解析层**做齐：SRT / VTT / ASS 三个解析器（`src/core/parse/**`）
与 `data/truth/format/*.json` 的 **24 份样本全部 0 容差**（cue 数 / 起止时间 / 行号映射 / 解析诊断码），
并落定 G11（SRT 接受前导负号 → T07 产出 `timing.negative-start`）、G12（`parse.skipped-block` /
`parse.skipped-comment`）、G13（块内空行 = 块终止符，孤儿内容显式报错）。
**下一棒从 M3 时序开工**，完整交接见 `plan/HANDOFF-M3.md`。

交下去的四件必须逐行兑现：

1. **招牌动词表（§四）**：每行都要有交付态入口与断言，M4/M5 逐行填绿；填不出的词从标题与首段删除。
2. **提交材料实物表（§五）**：每项都有路径与产出里程碑；M6 用文件存在性核对。
3. **形态自查表（§七）**：唯一形态为单文件 HTML，e2e 必须从**产物文件**打开跑通，不能只测模块函数。
4. **发布三件套**：M6 必须含 **tag + Release 附产物（本地留副本 + sha256）+ `plan/RELEASE-M6.md` 留档**，收尾跑布局门与口径门。
