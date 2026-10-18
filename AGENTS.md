# AGENTS.md

本仓库遵循 **`ai-tool-project-sprint`** 方法论（装订日期：2026-10-18）。

## 任何新对话的第一件事

```bash
node tools/check-sprint-layout.mjs    # 布局门；必须绿，红了先修布局再干活
node tools/check-ruleset.mjs          # 口径门；data/README.md §4 与 ruleset 必须逐值一致
```

- 续接对话：读 `plan/HANDOFF-M<k>.md`（那是第 k 棒的收尾交接单），**先跑上面两条门**。
- 接手对话（无 HANDOFF）：先读 `plan/00`、`plan/05`、`plan/06` 与各 HANDOFF，重建"当前状态 + K 口径清单"再动手。
- **门不存在 = 本项目没装订** → 先补第零步，再做别的。

## 强制布局（布局门逐条断言，改动前先看这里）

| 项 | 位置 | 判据 |
| --- | --- | --- |
| 计划套件 | `plan/00–06` + `data/README.md` | 存在且各含必需小节（标题关键词） |
| 数据台账 | `data/README.md` | 依据查证记录 + 数值口径在位 |
| 口径镜像 | `data/ruleset.v1.json` | 与 `data/README.md` §4 逐值一致（`check-ruleset`） |
| 交接单 | `plan/HANDOFF-M<k>.md` | 每个 ✅ 里程碑一份（M0 已声明豁免）；下一待办里程碑的交接单必须已在 |
| 里程碑状态副本 | `plan/00` 里程碑表 + `plan/05` 状态表 + `README` 状态表 | **逐处一致**，枚举式断言 |
| 发布留档 | `plan/RELEASE-M<last>.md`（两栏）或 `plan/WRAPUP-M<n>.md` | 标题齐、覆盖对账表在 |
| 测试清单 | `package.json` 的 `test` 脚本 | 逐文件列出，且覆盖 `tests/**/*.test.mjs` 全集 |
| 构建产物 | `dist/subtitle-preflight.html` | 存在；`node tools/build.mjs --check` 逐字节一致 |

## 既定口径（动了会打挂门与测试）

- **K1**：全部阈值只在 `data/README.md` §4 定义；`data/ruleset.v1.json` 是其机器可读镜像，二者由 `tools/check-ruleset.mjs` 强制一致，**必须同提交修改**。
- **K2**：`src/core/**` 是纯函数层——不碰 DOM、不发网络、不读时钟、不读 locale。
- **K3**：`src/ui/**` 只消费 `core/pipeline`，不实现判定、不写阈值。
- **K4**：构建与测试共用 `tools/bundle.mjs` 的同一条拼装路径；`SOURCE_FILES` 必须与 `src/**/*.js` 实际集合逐项相等。
- **K5**：报告默认不含时间戳、不含随机 ID、不含本机绝对路径；findings 按 `(line, ruleId)` 排序。
- **K6**：单文件产物零外链、零网络请求；`<a href>` 之外的任何外部资源引用都判红。
- **K7**：未实现的规则必须在报告 `skipped[]` 与 `capabilities` 中显式声明，不得静默返回空。

## 环境事实与禁忌

- 本机（2026-10-18 实测）：Node `v24.15.0`；`py -3.12` 可用（含 PyYAML 6.0.3，仅用于本地 YAML 校验）；`py -3.8` 可用；Chrome 155 可用于 headless e2e。
- 本项目运行时零第三方依赖；`node_modules/` 不入仓。
- 禁止：把"未执行"写成已完成；在 tag 之后改代码面；把真实影视字幕入仓（版权红线）。
- 远端：**本轮未建**。任何"CI 绿"的表述必须写成"本地等价校验（未接远端，CI 待首推验证）"。

## 关键命令

```bash
node tools/check-sprint-layout.mjs     # 布局门
node tools/check-ruleset.mjs           # 口径门
node tools/selftest-layout.mjs         # 布局门 7 组变异自检
npm test                               # 全量测试（逐文件列出）
node tools/build.mjs                   # 构建单文件产物
node tools/build.mjs --check           # 产物与源码是否同基线
node tools/e2e-browser.mjs             # 浏览器 e2e（需本机 Chrome/Edge；缺则 exit 3）
```
