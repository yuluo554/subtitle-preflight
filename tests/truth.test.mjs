import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ROOT } from "../tools/bundle.mjs";

function runGate(cwd) {
  try {
    const stdout = execFileSync(process.execPath, ["tools/check-truth.mjs"], {
      cwd: cwd || ROOT,
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

const EXCLUDE = new Set([".git", "node_modules", "dist", "out", "tmp"]);

function copyRepo() {
  const dest = mkdtempSync(join(tmpdir(), "sp-truth-"));
  cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => {
      const rel = src.slice(ROOT.length).replace(/^[\\/]/, "").split("\\").join("/");
      if (!rel) return true;
      return !EXCLUDE.has(rel.split("/")[0]);
    },
  });
  return dest;
}

function withCopy(fn) {
  const dir = copyRepo();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function patchJson(dir, rel, mutate) {
  const path = join(dir, rel);
  const data = JSON.parse(readFileSync(path, "utf8"));
  mutate(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

test("真值门：仓库内全绿且自报扫描量（非空跑）", () => {
  const result = runGate();
  assert.equal(result.code, 0, result.stdout + (result.stderr || ""));
  assert.ok(result.stdout.includes("这轮扫到"), "门必须自报扫描量");
  const m = /样本 (\d+) \/ 真值 (\d+) \/ cue (\d+) \/ 期望项 (\d+)/.exec(result.stdout);
  assert.ok(m, "必须自报四项计数");
  assert.equal(Number(m[1]), 42, "样本数应为 42（24 格式 + 13 时序 + 4 可读性 + 1 卫生）");
  assert.ok(Number(m[3]) >= 200, `cue 数偏少（${m[3]}），扫描面可能空跑`);
  const ids = result.stdout
    .split("\n")
    .filter((l) => /^(PASS|FAIL)\s{2}TRUTH\./.test(l))
    .map((l) => l.split(/\s{2,}/)[1]);
  assert.ok(ids.length >= 6, `检查项偏少（${ids.length}）`);
  assert.equal(new Set(ids).size, ids.length, "检查项 id 重复");
});

test("真值门：连跑两次结论条数不变（结果不残留）", () => {
  const count = (out) => out.split("\n").filter((l) => /^(PASS|FAIL)\s{2}TRUTH\./.test(l)).length;
  assert.equal(count(runGate().stdout), count(runGate().stdout));
});

test("真值门：写入 observed 字段必须变红", () => {
  withCopy((dir) => {
    assert.equal(runGate(dir).code, 0, "副本基线必须先绿");
    patchJson(dir, "data/truth/timing/t01-overlap.json", (d) => {
      d.expectFindings[0].observed = 1500;
    });
    const mutated = runGate(dir);
    assert.equal(mutated.code, 1);
    assert.ok(mutated.stdout.includes("TRUTH.NO_OBSERVED"), "应命中 NO_OBSERVED: " + mutated.stdout);
  });
});

test("真值门：删一份真值必须变红（样本 ↔ 真值不再一一对应）", () => {
  withCopy((dir) => {
    rmSync(join(dir, "data/truth/hygiene/hygiene-golden.json"));
    const mutated = runGate(dir);
    assert.equal(mutated.code, 1);
    assert.ok(mutated.stdout.includes("TRUTH.PAIRS"), "应命中 PAIRS: " + mutated.stdout);
    assert.ok(mutated.stdout.includes("缺真值"), "应点名缺真值: " + mutated.stdout);
  });
});

test("真值门：README §3 少列一条规则必须变红（清单两来源不一致）", () => {
  withCopy((dir) => {
    const rel = "data/truth/README.md";
    const path = join(dir, rel);
    const before = readFileSync(path, "utf8");
    const after = before.split("\n").filter((l) => !l.startsWith("| `timing.fps-drift`")).join("\n");
    assert.notEqual(after, before, "变异靶子（fps-drift 行）不存在");
    writeFileSync(path, after, "utf8");
    const mutated = runGate(dir);
    assert.equal(mutated.code, 1);
    assert.ok(mutated.stdout.includes("TRUTH.INVENTORY"), "应命中 INVENTORY: " + mutated.stdout);
  });
});

test("真值门：把可读性 cue 数改成 199 必须变红（覆盖度不足）", () => {
  withCopy((dir) => {
    patchJson(dir, "data/truth/readability/readability-zh.json", (d) => {
      d.cues.pop();
    });
    const mutated = runGate(dir);
    assert.equal(mutated.code, 1);
    assert.ok(mutated.stdout.includes("TRUTH.COVERAGE"), "应命中 COVERAGE: " + mutated.stdout);
    assert.ok(mutated.stdout.includes("≠ 200") || mutated.stdout.includes("200"), "应点名 200: " + mutated.stdout);
  });
});

test("真值门：非法用法必须 exit 2 且有提示", () => {
  let code = null;
  let stderr = "";
  try {
    execFileSync(process.execPath, ["tools/check-truth.mjs", "--bogus"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    code = error.status;
    stderr = String(error.stderr || "");
  }
  assert.equal(code, 2);
  assert.ok(stderr.includes("用法"));
});

test("真值门：被检查对象缺失时报 FAIL 并继续，不是抛异常逃逸", () => {
  withCopy((dir) => {
    rmSync(join(dir, "data/truth/coverage.json"));
    const mutated = runGate(dir);
    assert.equal(mutated.code, 1);
    assert.ok(mutated.stdout.includes("TRUTH.MATRIX"), "应命中 MATRIX: " + mutated.stdout);
    assert.ok(mutated.stdout.includes("结论"), "必须输出结论行（未中途崩掉）");
  });
});

test("覆盖率矩阵：与真值同源（写在 data/truth/coverage.json，由生成器派生）", () => {
  const matrix = JSON.parse(readFileSync(join(ROOT, "data/truth/coverage.json"), "utf8"));
  assert.equal(matrix.rulesetVersion, 1);
  assert.equal(matrix.domains.timing.length, 12);
  assert.equal(matrix.domains.readability.length, 7);
  assert.equal(matrix.domains.hygiene.length, 10);
  assert.equal(matrix.counts.readabilityCues, 200);
  assert.equal(matrix.counts.hygieneCues, 30);
  assert.equal(matrix.counts.formatSamples, 24);
  const drift = matrix.domains.timing.find((e) => e.ruleId === "timing.fps-drift");
  assert.deepEqual(drift.positiveSamples, ["timing/t11-fps-drift"], "fps-drift 的正例样本是 t11");
  assert.ok(String(drift.notes).includes("M3"), "待实现规则必须在矩阵里写明 M3");
  // 目录名与真值目录一致（防止矩阵指向不存在的样本）
  const dirOf = (rel) => dirname(rel);
  for (const entry of matrix.domains.timing) {
    for (const ref of entry.negativeSamples) assert.equal(dirOf(ref), "timing");
  }
});
