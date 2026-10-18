#!/usr/bin/env node
/**
 * 布局门的变异自检（可重复、可进 CI）。
 *
 * 做法：把仓库（去掉 .git / node_modules / dist）复制到临时目录，逐组做**真实数据变异**，
 * 跑布局门，断言它变红；还原后断言重新变绿。
 * 这比"手工删一次文件看看"强的地方：每一组都断言了"变异真的发生了"，且失败会点名是哪组。
 *
 * 纪律：
 *  - 变异点选"数据"不选"措辞"（改标题前缀不算）。
 *  - 每组都断言：变异前该 marker 存在 → 变异后文件字节已变 → 还原后字节一致。
 *  - 每组都在**副本**里跑，不碰工作树。
 *
 * 退出码：0 全部变异都被检出 / 1 有变异未被检出（假门）/ 2 用法错误。
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length) {
  process.stderr.write("用法: node tools/selftest-layout.mjs\n");
  process.exit(2);
}

const EXCLUDE = new Set([".git", "node_modules", "dist", "out", "tmp"]);

function copyRepo(dest) {
  cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(ROOT.length).replace(/^[\\/]/, "").split("\\").join("/");
      if (!rel) return true;
      const top = rel.split("/")[0];
      return !EXCLUDE.has(top);
    },
  });
}

function runGate(cwd) {
  try {
    const stdout = execFileSync(process.execPath, ["tools/check-sprint-layout.mjs"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (error) {
    return {
      code: typeof error.status === "number" ? error.status : 1,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
    };
  }
}

function mutateText(dir, rel, from, to) {
  const path = join(dir, rel);
  const before = readFileSync(path, "utf8");
  if (!before.includes(from)) throw new Error(`变异 marker 不存在: ${rel} :: ${from}`);
  const after = before.replace(from, to);
  if (after === before) throw new Error(`变异未产生字节变化: ${rel}`);
  writeFileSync(path, after, "utf8");
  return () => writeFileSync(path, before, "utf8");
}

function mutateRemove(dir, rel) {
  const path = join(dir, rel);
  if (!existsSync(path)) throw new Error(`变异目标不存在: ${rel}`);
  const before = readFileSync(path);
  rmSync(path, { recursive: true, force: true });
  return () => writeFileSync(path, before);
}

/** 把某个表格行里的状态标记翻成 ⬜（只改数据行，不改表头/措辞）。 */
function flipStatus(dir, rel, milestone, from, to) {
  const path = join(dir, rel);
  const before = readFileSync(path, "utf8");
  const lines = before.split("\n");
  const idx = lines.findIndex((l) => new RegExp(`^\\|\\s*\\*{0,2}M${milestone}\\b`).test(l));
  if (idx < 0) throw new Error(`找不到 M${milestone} 的状态行: ${rel}`);
  if (!lines[idx].includes(from)) throw new Error(`M${milestone} 行里没有 ${from}（已是别的状态？）`);
  lines[idx] = lines[idx].replace(from, to);
  if (lines[idx] === before.split("\n")[idx]) throw new Error("变异未产生字节变化");
  writeFileSync(path, lines.join("\n"), "utf8");
  return () => writeFileSync(path, before, "utf8");
}

/** 每组：名称 / 期望命中的检查项 id / 变异函数。 */
const MUTATIONS = [
  {
    name: "M1 删 AGENTS.md",
    expect: "LAYOUT.FILES",
    apply: (dir) => mutateRemove(dir, "AGENTS.md"),
  },
  {
    name: "M2 把一个 ✅ 里程碑在一个副本里翻成 ⬜",
    expect: "LAYOUT.STATUS",
    apply: (dir) => flipStatus(dir, "plan/05-里程碑与发布.md", 0, "✅", "⬜"),
  },
  {
    name: "M3 把已 ✅ 的里程碑写回 plan/06 的缺口列",
    expect: "LAYOUT.GAPS",
    apply: (dir) =>
      mutateText(
        dir,
        "plan/06-交付对标与决策.md",
        "| G01 | VTT / ASS 解析器 | M2 |",
        "| G01 | VTT / ASS 解析器（M0 未完成） | M2 |"
      ),
  },
  {
    name: "M4 删一份交接单 HANDOFF-M1",
    expect: "LAYOUT.HANDOFFS",
    apply: (dir) => mutateRemove(dir, "plan/HANDOFF-M1.md"),
  },
  {
    name: "M5 删 plan/00 顶部装订行",
    expect: "LAYOUT.BINDING_HEAD",
    apply: (dir) => {
      const rel = "plan/00-README总览.md";
      const path = join(dir, rel);
      const before = readFileSync(path, "utf8");
      const lines = before.split("\n");
      const idx = lines.findIndex((l) => l.includes("check-sprint-layout"));
      if (idx < 0) throw new Error("装订行不存在，无法变异");
      lines.splice(idx, 1);
      writeFileSync(path, lines.join("\n"), "utf8");
      return () => writeFileSync(path, before, "utf8");
    },
  },
  {
    name: "M6 package.json 的 test 脚本漏列一个测试文件",
    expect: "LAYOUT.TESTS",
    apply: (dir) =>
      mutateText(dir, "package.json", " tests/gates.test.mjs", ""),
  },
  {
    // 非空跑自证：副本存在但一行状态都没有 = "扫了 0 个"，必须红
    name: "M7 把 README 的里程碑状态表整块删掉（副本空跑）",
    expect: "LAYOUT.STATUS",
    apply: (dir) => {
      const rel = "README.md";
      const path = join(dir, rel);
      const before = readFileSync(path, "utf8");
      const lines = before.split("\n");
      const start = lines.findIndex((l) => l.startsWith("| 里程碑 |"));
      if (start < 0) throw new Error("README 里找不到里程碑状态表头");
      let end = start;
      while (end < lines.length && lines[end].startsWith("|")) end += 1;
      if (end - start < 3) throw new Error("状态表行数异常，变异靶子不对");
      lines.splice(start, end - start);
      const after = lines.join("\n");
      if (after === before) throw new Error("变异未产生字节变化");
      writeFileSync(path, after, "utf8");
      return () => writeFileSync(path, before, "utf8");
    },
  },
];

const results = [];

for (const mutation of MUTATIONS) {
  const dir = mkdtempSync(join(tmpdir(), "sp-layout-"));
  let restore = null;
  let ok = false;
  let detail = "";
  try {
    copyRepo(dir);

    const baseline = runGate(dir);
    if (baseline.code !== 0) {
      detail = `副本基线就不是绿的（exit ${baseline.code}），变异结论无意义`;
    } else {
      restore = mutation.apply(dir);
      const mutated = runGate(dir);
      const hit = mutated.code === 1 && mutated.stdout.includes(mutation.expect);
      ok = hit;
      detail = hit
        ? `检出（exit 1，命中 ${mutation.expect}）`
        : `未检出（exit ${mutated.code}，期望命中 ${mutation.expect}）`;
      if (!hit) detail += "\n" + (mutated.stdout || mutated.stderr || "").trim();
      restore();
      restore = null;
      const restored = runGate(dir);
      if (restored.code !== 0) {
        ok = false;
        detail += `；还原后未复绿（exit ${restored.code}）`;
      }
    }
  } catch (error) {
    detail = "变异脚本异常: " + error.message;
  } finally {
    if (restore) {
      try {
        restore();
      } catch (error) {
        detail += "；还原失败: " + error.message;
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
  results.push({ name: mutation.name, ok, detail });
}

const failed = results.filter((r) => !r.ok);
process.stdout.write("布局门变异自检（每组在独立副本里跑，不碰工作树）\n");
process.stdout.write("=".repeat(64) + "\n");
for (const r of results) {
  process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  ${r.detail}\n`);
}
process.stdout.write("=".repeat(64) + "\n");
process.stdout.write(`这轮跑了 ${results.length} 组变异，${results.length - failed.length} 组被检出\n`);
process.stdout.write(`结论: ${failed.length === 0 ? "全绿（无假门）" : `${failed.length} 组未被检出`}\n`);
process.exitCode = failed.length === 0 ? 0 : 1;
