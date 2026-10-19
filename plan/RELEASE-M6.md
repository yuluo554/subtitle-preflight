# RELEASE-M6 · 发布留档（tag v0.1.0）

> 两栏纪律：**tag 前事实**只写 tag 之前就能确证的事；**tag 后追加**只写 tag 之后发生的可核验事实。
> 未发生的事不得写进任何一栏（宁可留空并注明"待"）。
> 本文件在 M5 收尾时**建骨架并回填性能实测**（`plan/05` §四 / `data/README.md` §4.8 要求
> "M5 基准实测后把结果写入 `plan/RELEASE-M6.md` 与技术报告"）；tag 事实由 M6 填。

## 一、tag 前事实

| 项 | 事实 | 证据（命令 / 结果） |
|---|---|---|
| 产物 | `dist/subtitle-preflight.html`（v0.1.0 定版） | `node tools/build.mjs --check` 绿 |
| 版本号单一来源 | `package.json` 的 `version` = **0.1.0**；注入产物页脚 `subtitle-preflight v0.1.0`；README 顶部同名 | `tests/build.test.mjs`（四处一致断言） |
| 产物字节数 | **108369 bytes**（未压缩，LF，结尾换行） | `node tools/build.mjs` 输出行 |
| 产物 sha256（tag 前工作树） | `97cc1995830215a240096a0bd00f0d5e7623c381c9167667d62aa38330846679` | `sha256sum dist/subtitle-preflight.html`（定版时点） |
| 双跑逐字节 | `node tools/build.mjs` 连跑两次 `cmp` 一致 | `cmp` 输出为空 |
| 测试总量 | **246 项全绿**（21 个测试文件） | `npm test`（tag 树干净 clone 实测；早前文档记 245 为误数，见 §二） |
| 三格式样本 | 24 份（3 格式 × 8 变体），cue 边界 / 行号映射 / 诊断码 **0 容差** | `tests/samples_generator.test.mjs` |
| 时序 T01–T12 | 13 份真值 **0 容差**，无 pending | `tests/samples_generator.test.mjs` |
| 可读性 R01–R07 | 200 条标注 **0 容差** + 50 项边界单测 | `tests/samples_generator.test.mjs` + `readability_*.test.mjs` |
| 卫生 S01–S10 | 30 条 golden set **precision 100% / recall 100%** | `tests/hygiene_golden.test.mjs` |
| 修复单调性 | 可修样本 `after < before` 且每条规则不增加；不可修样本 `after === before` 且 `fixes[]` 为空 | `tests/fix_monotonic.test.mjs` |
| 报告三格式 | JSON / Markdown / CSV 同源；CSV 按 RFC 4180 | `tests/report_formats.test.mjs` |
| 样本与真值 | 85 文件位级一致、无孤儿；42 样本 ↔ 42 真值 | `node tools/gen-samples.mjs --check` + `node tools/check-truth.mjs` |
| 门 | 布局 / 口径 / 真值 / 变异自检（7 组）全绿 | `check-sprint-layout` / `check-ruleset` / `check-truth` / `selftest-layout` |
| 浏览器 e2e | **12 项全绿**（从产物文件 headless 打开） | `node tools/e2e-browser.mjs` |
| 脱敏扫描（tracked） | **HARD 0 / REVIEW 0**（扫描面 171 项；不含 3 份 GBK 样本，按 `git grep -I` 口径跳过） | `node tools/check-desensitize.mjs` |
| 脱敏扫描（history） | **HARD 0 / REVIEW 0**（扫描面 736 项 blob） | `node tools/check-desensitize.mjs --history` |
| 脱敏扫描（messages） | **HARD 0 / REVIEW 0**（作者/提交者邮箱 + tag tagger 邮箱，7 项） | `node tools/check-desensitize.mjs --messages` |
| 脱敏扫描器自检 | 阳性/阴性对照 9 项全绿（合成串程序化生成，无字面敏感值） | `node tools/check-desensitize.mjs --selftest` |
| 提交元数据邮箱 | 全部为 GitHub noreply（`*+<user>@users.noreply.github.com`） | `git log --format="%ae %ce" --all \| sort -u` |
| 二进制样本字节面 | 172 份 tracked 文件按原始字节扫（含 3 份非 UTF-8 GBK 样本）：0 命中 | 一次性脚本（见 §二 复现口径） |
| CI workflow 本地解析 | 1 job / 11 steps；4 矩阵（ubuntu/windows × node 20/24） | `py -3.12` + PyYAML 解析通过 |
| **性能（10MB / 5000 cue）** | 样本 10 558 893 bytes / 5000 cue；全流程（解码 → 解析 → 四域规则 → 报告三格式 → 修复）**min 1102.4ms / 中位 1242.9ms / max 1400.7ms**（5 轮，另含 1 轮预热不计入）；对照 `perf.targetWallMs=2000` **达标** | `node tools/gen-samples.mjs --perf` + `node tools/bench.mjs --runs 5` |
| 性能环境 | Node `v24.15.0`，Windows + Git Bash | `node --version` |
| 性能纪律 | **单机单次实测，非跨机器承诺**；`bench.mjs` 只测量、不判达标 | `tests/bench_contract.test.mjs` |
| CI | **未推送，未跑过任何 CI** | 本地等价校验（未接远端，CI 待首推验证） |
| tag | **尚未打** | 待 M6 |
| Release | **尚未创建** | 待 M6 |

## 二、tag 后追加

> tag 之后只允许文档面提交（`git diff --name-only v0.1.0..HEAD` 只含 `plan/`、`README.md`）。

| 项 | 事实 | 证据 |
|---|---|---|
| tag `v0.1.0` | annotated tag 对象 `17e3d789af3d5b06294f4b96340ebbd01f2ffd47`，指向提交 `63706395eef9588b5427928e7cde80223afd27b0` | 本地 `git rev-parse v0.1.0` == 远端 `git/ref/tags/v0.1.0` 的 `object.sha`（`gh api` 复核 type=tag，两端一致） |
| tagger 邮箱 | `282769740+yuluo554@users.noreply.github.com`（GitHub noreply） | `git for-each-ref refs/tags --format='%(taggeremail)'` |
| Release | `https://github.com/yuluo554/subtitle-preflight/releases/tag/v0.1.0`；`isDraft=false`、`isPrerelease=false` | `gh release view v0.1.0` |
| Release 附件 1 | `subtitle-preflight.html`，**108369 bytes**，`state=uploaded` | `gh release view --json assets`；真下载后与本地 `cmp` 逐字节一致 |
| Release 附件 2 | `subtitle-preflight-0.1.0.tar.gz`，**266626 bytes**，`state=uploaded` | 同上 |
| 附件 sha256（正文） | html `97cc1995830215a240096a0bd00f0d5e7623c381c9167667d62aa38330846679`；tarball `0f5c9c31c6133e96670b305a0227db3affd303e5ac0f8a12cae4e4eaf162273a`（GitHub asset digest 亦为同值） | `sha256sum` + `gh release view --json assets -q .digest` |
| 附件与 tag 树同源 | 从 `v0.1.0` 重新 `git archive … \| gzip -9n` → 与下载件 `cmp` 一致；解包源码树跑 `node tools/build.mjs` 产物 == 附件 html | 两条 `cmp` 均 `CMP_OK` |
| 附件口径 | **构建产物本身 + 手工确定性源码包**（非 GitHub 自动 Source code 包——后者本地复算不出 sha256） | 见上两行 |
| CI 首推（push 数 = run 数） | **3 次 push ↔ 3 条 run**（按 push 事件计）：`5b92dc8`（首推 main，failure）、`20ab396`（修 CI 假红，failure）、`6370639`（修 e2e Node20，**success**）；另 tag push `v0.1.0` 触发 **1 条 tag run，success** | `gh run list --json event,headBranch,headSha,conclusion` 逐条配对 |
| CI 四矩阵 | `6370639` 与 tag run 两次均 **ubuntu/windows × node 20/24 四矩阵全绿** | `gh run view <id> --json jobs` |
| 浏览器 e2e（CI 内） | **四矩阵上真实跑通**（非"环境缺失"）：各 job 均 `结论: 全绿`，含 `E2E.VERSION_VISIBLE` | CI 日志逐 job 复核 |
| 首推暴露并已修的两处 CI 假红 | ① 脱敏扫描器把环境取值 `runner` 判 HARD（跨 runner 时红时绿）→ 降级 REVIEW；② Node 20 无全局 `WebSocket` + profile 清理 `ENOTEMPTY` → e2e 自带零依赖 MiniWebSocket + 重试清理 | `20ab396`、`6370639` 两个提交；两次首跑失败日志 |
| 干净 clone 复核 | 从 GitHub 全新 `git clone` 到中立目录：布局/口径/真值/变异自检/生成器 **全绿**；`npm test` **246 项全绿**；`build --check` 绿；浏览器 e2e **全绿** | 逐条命令实测 |
| 测试数勘误 | tag 树实测 **246 项**（本地与干净 clone 一致）；早前 `plan/RELEASE-M6` 骨架与 `docs/技术报告.md` 记 245 为误数 | 见「事实与留档的时序」注 |
| 脱敏（tag 可达对象） | tracked / history / messages 三模式 **HARD 0**（tag 对象纳入 history 扫描） | `node tools/check-desensitize.mjs [--history] [--messages]` |

> **事实与留档的时序**：`docs/技术报告.md` 在 tag 树内、其「246 项」勘误**落在 tag 之后**，
> 但 tag 后只允许 `plan/`、`README.md` 改动 → 该文件在 tag 树内仍写 **245**。此处如实登记这处落后，
> 不重打 tag（`docs/` 不是发布状态的第一手来源；随包读者看 `plan/` 与 Release 页）。
> `README.md` 与 `plan/` 内的计数已在 tag 后提交中修正为 **246**。

## 三、阶段 7 覆盖对账表

> 三态：**实现**（有交付态入口 + 断言）/ **不适用**（写死理由）/ **待首推**（本地已验、远端未跑）。

| # | 覆盖项 | 三态 | 证据 / 理由 |
|---|---|---|---|
| 1 | 三格式解析（SRT/VTT/ASS） | 实现 | 24 份样本 0 容差（`tests/samples_generator.test.mjs`） |
| 2 | 原文行号映射 | 实现 | 三格式 × 8 变体行号 0 容差；`findings[].line` 可回原文行 |
| 3 | 编码嗅探与 GBK 回退 | 实现 | `tests/decode.test.mjs` + 3 份 GBK 样本；界面与报告双处标注 |
| 4 | 12 类时序缺陷 + fps 漂移拟合 | 实现 | 13 份真值 0 容差；复原 scale 误差 0.07ms < 1 帧（`tests/drift_fit.test.mjs`） |
| 5 | 可读性 7 类 | 实现 | 200 条标注 0 容差 + 50 项边界单测；语言档 zh/en/ja 三档实测 |
| 6 | 卫生 10 类 | 实现 | 30 条 golden set precision 100% / recall 100%（`tests/hygiene_golden.test.mjs`） |
| 7 | 三格式报告（JSON/MD/CSV） | 实现 | 同源 + RFC 4180（`tests/report_formats.test.mjs`）；双跑逐字节一致 |
| 8 | 可逆修复 + diff | 实现 | 单调下降 + 不可修样本（`tests/fix_monotonic.test.mjs`） |
| 9 | 10MB / 5000 cue 性能 | 实现 | 本机实测回填（见 §一）；**单机单次，非跨机器承诺** |
| 10 | 单文件产物零外链 / 零网络 | 实现 | 构建期静态扫描 + `tests/artifact_e2e.test.mjs` + headless e2e 实测 0 外网请求 |
| 11 | 浏览器 e2e（本地） | 实现 | `tools/e2e-browser.mjs` **12 项全绿**（含页脚版本号可见） |
| 12 | 浏览器 e2e（CI 矩阵内） | **实现** | 四矩阵上真实跑通（各 job `结论: 全绿`，非"环境缺失"）；见 §二 |
| 13 | CI 四矩阵 | **实现** | push 数=run 数（3↔3）+ tag run 1 条；`6370639` 与 tag run 四矩阵全绿 |
| 14 | GitHub Release 附产物 | **实现** | tag `v0.1.0` + 2 附件 `state=uploaded` + sha256 进正文；见 §二 |
| 15 | 音频强制对齐 / 自动断句 / 平台规则库 | 不适用 | 与"只做可逆无损修复 + 零依赖单文件"的红线冲突（`docs/技术报告.md` §六） |
| 16 | CLI / 桌面 exe / 本地服务 | 不适用 | 形态收敛为单文件 HTML（`plan/00` §二 决策记录） |
| 17 | 多形态并行 | 不适用 | 避免"CLI 真做、界面空壳"的通行证（`plan/00` §二 决策记录） |
