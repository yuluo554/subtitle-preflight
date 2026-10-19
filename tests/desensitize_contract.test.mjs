import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "../tools/bundle.mjs";

/**
 * 脱敏扫描器的**运行时形态**测试（不测"当前 0 命中"——那会随仓库内容漂移）。
 * 照 sprint 阶段 7 纪律：发布门/扫描器要有回归测试，但常驻测试只锁脚本形态与自检。
 */

function run(args) {
  return execFileSync("node", [join(ROOT, "tools/check-desensitize.mjs"), ...args], {
    encoding: "utf8",
  });
}

function runStatus(args) {
  try {
    const out = execFileSync("node", [join(ROOT, "tools/check-desensitize.mjs"), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status, out: (error.stdout || "") + (error.stderr || "") };
  }
}

test("脱敏扫描器：自检（阳性/阴性对照）全绿", () => {
  const out = run(["--selftest"]);
  assert.ok(out.includes("全绿"), "自检未全绿:\n" + out);
  assert.ok(out.includes("PASS  personal-home-path"));
  assert.ok(out.includes("PASS  personal-email"));
});

test("脱敏扫描器：非法用法 exit 2", () => {
  const { code, out } = runStatus(["--bogus"]);
  assert.equal(code, 2, "非法用法应 exit 2:\n" + out);
  assert.ok(out.includes("用法"));
});

test("脱敏扫描器：tracked 模式非空跑且不回显敏感串原文", () => {
  const out = run([]);
  assert.ok(/扫描面 \d+ 项/.test(out), "缺扫描面计数（空跑？）:\n" + out);
  assert.ok(out.includes("结论:"), "缺结论行");
});

test("脱敏扫描器：输出形态是「文件:行号 [类别]」而非原文回显", () => {
  const out = run([]);
  for (const line of out.split("\n")) {
    if (line.startsWith("HIT ") || line.startsWith("REVIEW ")) {
      assert.ok(/\[[a-z-]+\]$/.test(line), "命中行缺类别标签（疑似回显原文）: " + line);
    }
  }
});
