# HANDOFF-M1 · 下一棒 = 数据先行

> 用法（相对路径）：本文件 `plan/HANDOFF-M1.md`。新对话启动时由用户侧拼绝对路径。
> 第一动作：`node tools/check-sprint-layout.mjs`（红了先修布局，再干活）。

## 一、当前进度 + 证据

M0（装订 + 计划 + 可运行骨架）已完成并提交。

| 产物 | 位置 | 证据（命令 / 结果） |
|---|---|---|
| 方法论锚点 | `AGENTS.md` | 布局门 `LAYOUT.FILES` PASS |
| 装订行 | `plan/00` 顶部 | `LAYOUT.BINDING_HEAD` PASS |
| 布局门 | `tools/check-sprint-layout.mjs` | 10 项检查全绿，自报扫描量 |
| 布局门变异自检 | `tools/selftest-layout.mjs` | 6 组变异全部检出，还原后复绿 |
| 口径门 | `tools/check-ruleset.mjs` | §4 ↔ `data/ruleset.v1.json` 双向逐值一致 + 源码零阈值字面量 |
| 计划套件 | `plan/02–06` | `LAYOUT.SECTIONS` PASS |
| 分层源码 | `src/core/**`、`src/ui/**` | 架构测试 5 项 PASS |
| 单文件构建 | `tools/bundle.mjs`、`tools/build.mjs` | `build --check` PASS；两次渲染逐字节一致 |
| 产物 | `dist/subtitle-preflight.html` | 零外链 / 零网络调用 / 无本机路径 |
| 测试 | `tests/*.test.mjs`（8 个文件） | `npm test` 全绿（83 项） |
| 浏览器 e2e | `tools/e2e-browser.mjs` | headless Chrome 从产物文件打开：7 项 PASS |
| e2e 变异验证 | — | 断开 UI 接线后 5 项 FAIL，还原后全绿（不是假门） |
| CI 配置 | `.github/workflows/ci.yml` | 本地 YAML 解析通过（1 job / 9 steps）；**未推送，CI 待首推验证** |

已实现能力：SRT 解析（8 类变体中的 7 类）、编码嗅探 + GBK 回退、SHA-256、时序 T01–T10 + T12、
JSON 报告（确定性）、单文件构建、拖放/粘贴界面、浏览器 e2e。

未实现能力（已在产物 `capabilities` / `skipped[]` 显式声明）：VTT/ASS 解析、T11 fps 漂移、
可读性 7 类、卫生 10 类、修复、Markdown/CSV、性能实测。

## 二、下一棒待办（M1 数据先行）

1. `tools/gen-samples.mjs`：固定种子、LF、按 Unicode 码点序写出；`--check` 位级一致。
2. 24 份格式变体（3 格式 × 8 变体）+ `data/truth/format/*.json`。
   - SRT 侧的 8 类已在测试里覆盖，但**样本要落成文件**，不能只留在测试字符串里。
3. 12 类时序缺陷样本 + 真值；`expectFindings` 只写 `ruleId` + `line`（必要时 `field`）。
4. 200 条可读性标注 cue + 30 条卫生 golden set（本轮只落数据与真值，规则在 M4/M5 实现）。
5. `tools/check-truth.mjs`：样本 ↔ 真值一一对应、无孤儿、无 `observed` 字段。
6. 植入器自证：每处植入断言 diff 非空；虚构名白名单（禁用词表命中即抛错）。
7. 把 `package.json` 的 `test` 脚本与新测试文件同步（布局门 `LAYOUT.TESTS` 会抓漏列）。
8. 收尾写 `plan/HANDOFF-M2.md` 并回写三处状态副本。

## 三、既定口径清单（K 编号，动了会打挂测试）

- **K1**：阈值只在 `data/README.md` §4；`data/ruleset.v1.json` 是镜像，二者由 `check-ruleset` 强制一致，**必须同提交修改**。
- **K2**：`src/core/**` 纯函数——不碰 DOM、不发网络、不读时钟、不读 locale、不用 `Math.random`。
- **K3**：`src/ui/**` 只消费 `core/pipeline`，不实现判定、不写阈值、不直接依赖 `core/rules/**`。
- **K4**：构建与测试共用 `tools/bundle.mjs` 的 `SOURCE_FILES`；清单必须等于 `src/**/*.js` 实际集合。
- **K5**：报告无时间戳 / 随机 ID / 本机路径；findings 按 `(line, ruleId)` 排序；键序固定。
- **K6**：单文件产物零外链、零网络调用；`<a href>` 之外的外部资源引用一律判红。
- **K7**：未实现能力必须进 `skipped[]` 与 `capabilities`，不得静默返回空。
- **K8**：状态副本 3 处（`plan/00` 里程碑表 / `plan/05` 状态表 / `README` 状态表），逐处一致。
- **K9**：布局门要求"下一待办里程碑的 HANDOFF 已落盘"——收尾必须写下一棒交接单。
- **K10**：测试文件必须逐项列进 `package.json` 的 `test` 脚本（Node 目录形式不可靠）。

## 四、本机环境坑（只写实测过的）

- Node `v24.15.0`；`TextDecoder('gbk', {fatal:true})` 可用（实测解出"你好"）。
- `py -3.12` 带 PyYAML 6.0.3，用于本地解析 `ci.yml`；`py -3.8` 也在。
- 本机 Windows + Git Bash：临时目录用 `os.tmpdir()`，别用 `/tmp/...` 传给原生程序。
- 远端**未建**：任何"CI 绿"必须写成"本地等价校验（未接远端，CI 待首推验证）"。
- `dist/` 在 `.gitignore` 里只放行 `subtitle-preflight.html` 与 `.gitkeep`；构建产物**入仓**（发布附件即它本身）。

## 五、DoD 逐项 checklist（M1）— 已全部达成

- [x] `tools/gen-samples.mjs` 存在且 `--check` 位级一致（85 文件，无孤儿）
- [x] `data/samples/format/` 24 份 + `data/truth/format/` 24 份
- [x] `data/samples/timing/` 12 类各 ≥ 1 份 + 1 份干净基线 + 真值
- [x] `data/samples/readability/` 200 条标注 + 真值（4 文件：zh 60 / en 60 / ja 40 / 混排 40）
- [x] `data/samples/hygiene/` 30 条 golden set + 真值（10 正例 + 10 已知不报 + 10 边界）
- [x] `tools/check-truth.mjs` 全绿（无孤儿、无 `observed`/`actual`/`message`、覆盖度全绿）
- [x] 植入器自证（每处植入 diff 非空，且干净基线在独立判定式下不报该规则）
- [x] 虚构名白名单校验在位（禁用词表命中即抛错，并自证"命中必抛"）
- [x] `npm test` 全绿；`node tools/build.mjs --check` 绿
- [x] `node tools/e2e-browser.mjs` 全绿（本机 Chrome；缺浏览器时 exit 3 记"环境缺失"不记通过）
- [x] `node tools/check-sprint-layout.mjs` 绿；`node tools/check-ruleset.mjs` 绿；`node tools/selftest-layout.mjs` 绿
- [x] `plan/HANDOFF-M2.md` 已落盘；三处状态副本已回写

> 额外兑现（不在原 DoD 但为 M2 铺路）：SRT 侧 8 份格式样本被**当前解析器 0 容差复现**；
> `.gitattributes` 声明 `data/samples/**` 与 `data/truth/**` 为 `-text`（位级保真，实测 git blob 保留 `\r\n`）。

## 六、关键命令速查

```bash
node tools/check-sprint-layout.mjs     # 布局门（第一件事）
node tools/check-ruleset.mjs           # 口径门
node tools/selftest-layout.mjs         # 布局门 7 组变异自检
npm test                               # 全量测试（逐文件列出，83 项）
node tools/build.mjs                   # 构建单文件产物
node tools/build.mjs --check           # 产物与源码同基线
node tools/e2e-browser.mjs             # 浏览器 e2e（需本机 Chrome/Edge；缺则 exit 3）
npm run verify                         # 三道门 + 测试 + 构建检查
```
