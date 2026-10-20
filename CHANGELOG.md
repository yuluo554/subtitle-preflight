# Changelog

## 0.1.1 — 2026-10-20

交付面（`src/` / `data/`）**零改动**；判题引擎、规则、报告、修复全部与 0.1.0 逐字节同源。本轮是工具与收口修复。

### 修复

- **脱敏扫描器（`tools/check-desensitize.mjs`）tracked 模式在无 `.git` 环境**（如 `git archive` 解包树）
  不再抛 uncaught 错误：打印 `SKIP 环境缺失：tracked 扫描需要 git 工作树（…）` 并按既有退出码契约
  **exit 3**（与 `--history` / `--messages` 对齐）。`tests/desensitize_contract.test.mjs` 的 tracked 测试
  在无 `.git` 时显式 skip；有 `.git` 时「缺扫描面计数 → fail」强断言保留。

### 新增

- **测试计数守门**（`tests/count_guard.test.mjs`）：`npm test` 实测数必须等于
  `docs/技术报告.md` 与 `plan/RELEASE-M6.md §二` 的登记值，漂移即红（兼容 TTY「ℹ tests N」
  与非 TTY TAP「# tests N」两种 reporter；经中立子进程代跑 + 重入保护防计数不收敛）。
  全量测试 246 → **247**。

### 变更

- **CI**：`actions/checkout`、`actions/setup-node` v4 → **v7**（Node 20 弃用注解清零）；
  Node 矩阵 `["20","24"]` → **`["22","24"]`**（Node 20 已于 2026-04-30 EOL）。
- 文档数字收口：技术报告/RELEASE-M6 的测试总数勘误链（245→246→247）与扫描面计数
  「环境相关值」口径登记（见 `plan/RELEASE-M6.md` §二）。

### 验证

- 本机与干净 clone：`npm test` 247/247/0；四道门 + `selftest-layout` 7 变异 7 检出全绿；
  `gen-samples --check` 85/85 位级一致；`build --check` 同基线。
- CI 四矩阵（ubuntu/windows × node 22/24）push run 全绿。
- `dist/subtitle-preflight.html` 与 0.1.0 仅差页脚版本号（`v0.1.1`）。
