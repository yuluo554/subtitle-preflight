import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../tools/bundle.mjs";

/**
 * 测试计数守门：文档登记的测试数必须 == `npm test` 实测。
 * 背景：测试数曾两处漂移（245 误数进 tag 树等）——加测试不改文档就会红，
 * 把「文档计数」从无门覆盖的声明变成有门覆盖的声明。
 *
 * 范围（B1.3）：docs/技术报告.md 与 plan/RELEASE-M6.md 的登记值。
 *
 * 实现注记：不能在本测试文件里直接 execSync("npm test")——外层 node:test
 * 会判定「run() 被测试文件内递归调用」而跳过内层全套件（实测告警 +
 * 输出缺汇总行）。绕法 = 经一个中立的 `node -e` 子进程代跑 npm test。
 */

function runNpmTest() {
  const tmp = mkdtempSync(join(tmpdir(), "count-guard-"));
  const outPath = join(tmp, "out.txt");
  try {
    // node -e 脚本里无 node:test import，不触发递归守卫；合并 stderr 后落盘
    const script = `
      const { execFileSync } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const env = { ...process.env };
      // 外层 node:test 会给子进程注入 NODE_TEST_CONTEXT 等；不剥掉的话
      // 孙辈 node --test 会以 child 模式启动、汇总行走 IPC 不走 stdout
      delete env.NODE_TEST_CONTEXT;
      delete env.TEST_CHILD;
      // 内层 npm test 里本守门自身要跳过（重入保护），否则无限递归：
      // 内层计数 = 全部真测试数，外层（含本守门 1 项）= 内层 + 1
      env.COUNT_GUARD_SKIP = "1";
      try {
        const out = execFileSync("npm", ["test"], { encoding: "utf8", cwd: ${JSON.stringify(ROOT)}, stdio: ["ignore", "pipe", "pipe"], shell: true, maxBuffer: 64 * 1024 * 1024, env });
        writeFileSync(${JSON.stringify(outPath)}, out);
      } catch (e) {
        writeFileSync(${JSON.stringify(outPath)}, String(e.stdout || "") + String(e.stderr || "") + "\\nCOUNT_GUARD_NPM_FAIL");
      }
    `;
    execFileSync(process.execPath, ["-e", script], { stdio: "ignore" });
    const out = readFileSync(outPath, "utf8");
    assert.ok(!out.includes("COUNT_GUARD_NPM_FAIL"), "npm test 自身失败:\n" + out.slice(-600));
    const m = out.match(/^ℹ tests (\d+)\r?$/m);
    assert.ok(m, "npm test 输出缺「ℹ tests N」汇总行:\n" + out.slice(-600));
    return Number(m[1]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function registeredCounts() {
  const found = [];
  const report = readFileSync(join(ROOT, "docs/技术报告.md"), "utf8");
  const m1 = report.match(/\*\*(\d+) 项全绿\*\*（\d+ 个测试文件）/);
  assert.ok(m1, "docs/技术报告.md 缺「N 项全绿（N 个测试文件）」登记行");
  found.push(["docs/技术报告.md", Number(m1[1])]);

  // plan/RELEASE-M6.md §一 是 tag 前事实栏（纪律不许改），守门读 §二「tag 后追加」的登记行
  const release = readFileSync(join(ROOT, "plan/RELEASE-M6.md"), "utf8");
  const m2 = release.match(/当前全量测试数（tag 后追加栏登记[^）]*）\s*\| \*\*(\d+) 项\*\*/);
  assert.ok(m2, "plan/RELEASE-M6.md §二 缺「当前全量测试数」登记行");
  found.push(["plan/RELEASE-M6.md §二", Number(m2[1])]);
  return found;
}

test("测试计数守门：文档登记值 == npm test 实测", (t) => {
  // 重入保护：本守门经 node -e 代跑的内层 npm test 里，本测试跳过
  // （否则内层又跑守门、内层的内层再跑……测试数永远比登记值多且不收敛）。
  // 这是守门自身的重入保护，不是跳过产品断言；外层直接跑 npm test 时照常执行。
  if (process.env.COUNT_GUARD_SKIP === "1") {
    return t.skip("SKIP 重入保护：内层 npm test 不再嵌套跑守门（计数以带守门的外层为准）");
  }
  const actual = runNpmTest();
  for (const [file, registered] of registeredCounts()) {
    assert.equal(
      registered,
      actual,
      `${file} 登记测试数 ${registered} != 实测 ${actual}——新增/删除测试后须同步该文档`
    );
  }
});
