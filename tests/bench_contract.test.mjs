import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, readRuleset } from "../tools/bundle.mjs";

/**
 * 性能基准脚本的**形态**测试（不是"跑一次 10MB 看快不快"）。
 *
 * 10MB / 5000 cue 的实测值随机器变化，不适合进 CI 断言；但"基准脚本本身是不是空跑、
 * 有没有真的自报扫描量与耗时、口径键有没有被当成硬承诺"这些是**可以**断言的。
 * 因此这里用 `--sample` 换一个小样本，验契约。
 */
function run(args) {
  try {
    const stdout = execFileSync(process.execPath, ["tools/bench.mjs", ...args], {
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

const SMALL = "data/samples/timing/timing-clean-baseline.srt";

test("性能基准：跑小样本时自报扫描量、轮数与耗时（非空跑）", () => {
  const result = run(["--runs", "2", "--sample", SMALL]);
  assert.equal(result.code, 0, result.stdout + (result.stderr || ""));
  assert.ok(result.stdout.includes("样本:"), "必须自报用了哪个样本");
  assert.ok(result.stdout.includes(SMALL), "自报的样本名与实际不符");
  assert.ok(/样本: .+（\d+ bytes/.test(result.stdout), "必须自报样本字节数");
  assert.ok(/轮数 2（另有 1 轮预热/.test(result.stdout), "必须自报轮数并声明预热轮");
  assert.ok(/耗时: min [\d.]+ms \/ 中位 [\d.]+ms \/ max [\d.]+ms/.test(result.stdout), "必须自报耗时三值");
  assert.ok(result.stdout.includes("跨机器不可比"), "必须声明这不是跨机器承诺");
});

test("性能基准：--json 输出的结构完整，且不把口径键写成硬承诺", () => {
  const result = run(["--runs", "1", "--sample", SMALL, "--json"]);
  assert.equal(result.code, 0, result.stdout + (result.stderr || ""));
  const parsed = JSON.parse(result.stdout);
  for (const key of [
    "sample",
    "sampleBytes",
    "cues",
    "findings",
    "fixes",
    "reportBytes",
    "runs",
    "wallMs",
    "targetWallMs",
    "targetMet",
    "node",
  ]) {
    assert.ok(key in parsed, "结果缺字段: " + key);
  }
  assert.equal(parsed.runs, 1);
  assert.equal(parsed.wallMs.all.length, 1);
  assert.equal(parsed.cues, 8, "小样本应有 8 条 cue");
  assert.ok(parsed.findings >= 1, "小样本应有 finding（否则基准没跑到规则层）");
  // 口径键只作对照：断言它来自 ruleset，而不是脚本里的字面量
  const ruleset = readRuleset();
  assert.equal(parsed.targetWallMs, ruleset["perf.targetWallMs"]);
  assert.equal(typeof parsed.targetMet, "boolean");
});

test("性能基准：报的 findings 与直接跑 pipeline 的结果一致（不是自己编的数）", async () => {
  const { loadCore } = await import("./helpers/load.mjs");
  const { readFileSync } = await import("node:fs");
  const SP = loadCore();
  const bytes = readFileSync(join(ROOT, SMALL));
  const direct = SP.get("core/pipeline").run([{ name: "x.srt", bytes }], {}).results[0];
  const result = run(["--runs", "1", "--sample", SMALL, "--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.findings, direct.report.summary.total);
  assert.equal(parsed.cues, direct.file.cueCount);
  assert.equal(parsed.fixes, direct.report.fixes.length);
  assert.equal(parsed.reportBytes.json, Buffer.byteLength(direct.json));
  assert.equal(parsed.reportBytes.markdown, Buffer.byteLength(direct.markdown));
  assert.equal(parsed.reportBytes.csv, Buffer.byteLength(direct.csv));
});

test("性能基准：指定的样本不存在时报错退出，不是静默换样本", () => {
  const result = run(["--sample", "data/samples/timing/definitely-not-here.srt"]);
  assert.equal(result.code, 1);
  assert.ok(result.stderr.includes("指定的样本不存在"), "应显式报错: " + result.stderr);
});

test("性能基准：非法用法 exit 2 且有提示", () => {
  const result = run(["--runs", "0"]);
  assert.equal(result.code, 2);
  assert.ok(result.stderr.includes("--runs 必须是正整数"));
  const bogus = run(["--bogus"]);
  assert.equal(bogus.code, 2);
  assert.ok(bogus.stderr.includes("用法"));
});
