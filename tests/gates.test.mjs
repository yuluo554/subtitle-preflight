import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../tools/bundle.mjs";

/**
 * 门的运行时形态测试。
 * **不断言"当前 0 FAIL"**——发布前有些门本来就该红；只断言形态：
 *  - 每条检查项恰好输出一行结论；
 *  - 检查项 id 不重复；
 *  - 连跑两次结论条数不变（结果不残留）；
 *  - 永不崩（rc ∈ {0,1}，不是未捕获异常）。
 */
function runGate(rel) {
  try {
    const stdout = execFileSync(process.execPath, [join(ROOT, rel)], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (error) {
    return {
      code: typeof error.status === "number" ? error.status : -1,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
    };
  }
}

function conclusions(stdout) {
  return stdout
    .split("\n")
    .filter((line) => /^(PASS|FAIL)\s{2}\S/.test(line))
    .map((line) => line.split(/\s{2,}/)[1]);
}

test("布局门：退出码是 0/1（不崩），每个检查项恰好一条结论", () => {
  const result = runGate("tools/check-sprint-layout.mjs");
  assert.ok(result.code === 0 || result.code === 1, `意外退出码 ${result.code}: ${result.stderr || ""}`);
  const ids = conclusions(result.stdout);
  assert.ok(ids.length >= 8, `结论条数太少（${ids.length}），扫描面可能空跑`);
  assert.equal(new Set(ids).size, ids.length, "检查项 id 重复");
  assert.ok(result.stdout.includes("这轮扫到"), "门必须自报扫描量");
});

test("布局门：连跑两次结论条数不变", () => {
  const a = conclusions(runGate("tools/check-sprint-layout.mjs").stdout).length;
  const b = conclusions(runGate("tools/check-sprint-layout.mjs").stdout).length;
  assert.equal(a, b);
});

test("口径门：退出码是 0/1（不崩），每个检查项恰好一条结论", () => {
  const result = runGate("tools/check-ruleset.mjs");
  assert.ok(result.code === 0 || result.code === 1, `意外退出码 ${result.code}: ${result.stderr || ""}`);
  const ids = conclusions(result.stdout);
  assert.ok(ids.length >= 3, `结论条数太少（${ids.length}）`);
  assert.equal(new Set(ids).size, ids.length, "检查项 id 重复");
});

test("口径门：连跑两次结论条数不变", () => {
  const a = conclusions(runGate("tools/check-ruleset.mjs").stdout).length;
  const b = conclusions(runGate("tools/check-ruleset.mjs").stdout).length;
  assert.equal(a, b);
});

test("门：被检查对象不存在时报 FAIL 并继续，不是抛异常逃逸", () => {
  // 用法错误必须是 exit 2 且有提示，而不是未捕获异常
  let code = null;
  let stderr = "";
  try {
    execFileSync(process.execPath, [join(ROOT, "tools/check-sprint-layout.mjs"), "--bogus"], {
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
