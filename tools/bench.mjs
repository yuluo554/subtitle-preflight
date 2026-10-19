#!/usr/bin/env node
/**
 * 性能基准（M5）：在 10MB / 5000 cue 样本上实测全流程耗时。
 *
 * 用法：
 *   node tools/bench.mjs                 # 样本不存在时先调用 --perf 生成，再跑基准
 *   node tools/bench.mjs --runs 5        # 重复轮数（默认 3，取中位数）
 *   node tools/bench.mjs --json          # 只输出机器可读结果（供回填脚本消费）
 *   node tools/bench.mjs --sample <路径> # 换一个样本（测试用；默认 out/ 的 10MB 样本）
 *
 * 纪律：
 *  - 样本落在 `out/`（不入仓，`.gitignore` 已覆盖）。
 *  - 结果**只回填**（`plan/RELEASE-M6.md` 与技术报告），不写进 README 当承诺。
 *  - 口径键 `perf.targetWallMs` 只作对照，不当作"必须达成"的断言：
 *    本脚本只测量并打印，是否达标由人判断（不同机器不可比）。
 *  - 走的是与产物同一条执行路径（`tools/bundle.mjs` 的 SOURCE_FILES，K4）。
 *
 * 退出码：0 测量完成 / 1 环境或样本问题 / 2 用法错误
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, readRuleset } from "./bundle.mjs";
import { loadCore } from "../tests/helpers/load.mjs";

const args = process.argv.slice(2);
let runs = 3;
let jsonOnly = false;
let sampleRel = "out/perf-10mb-5000cues.srt";
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--runs") runs = Number(args[++i]);
  else if (args[i] === "--json") jsonOnly = true;
  else if (args[i] === "--sample") sampleRel = String(args[++i]);
  else {
    process.stderr.write("用法: node tools/bench.mjs [--runs <n>] [--json] [--sample <路径>]\n");
    process.exit(2);
  }
}
if (!Number.isInteger(runs) || runs < 1) {
  process.stderr.write("--runs 必须是正整数\n");
  process.exit(2);
}

const SAMPLE = sampleRel;
const samplePath = join(ROOT, SAMPLE);
const isDefaultSample = SAMPLE === "out/perf-10mb-5000cues.srt";

if (!existsSync(samplePath)) {
  if (!isDefaultSample) {
    process.stderr.write(`指定的样本不存在: ${SAMPLE}\n`);
    process.exit(1);
  }
  process.stderr.write(`样本不存在，先生成：node tools/gen-samples.mjs --perf\n`);
  try {
    execFileSync(process.execPath, ["tools/gen-samples.mjs", "--perf"], { cwd: ROOT, stdio: "ignore" });
  } catch (error) {
    process.stderr.write("生成性能样本失败: " + error.message + "\n");
    process.exit(1);
  }
}

const bytes = readFileSync(samplePath);
const ruleset = readRuleset();
const targetWallMs = ruleset["perf.targetWallMs"];

const SP = loadCore();
const pipeline = SP.get("core/pipeline");

/** 一次完整测量：解码 → 解析 → 四域规则 → 报告三格式 → 修复。 */
function once() {
  const t0 = process.hrtime.bigint();
  const outcome = pipeline.run([{ name: "perf-10mb-5000cues.srt", bytes }], {});
  const t1 = process.hrtime.bigint();
  const result = outcome.results[0];
  return {
    wallMs: Number(t1 - t0) / 1e6,
    cues: result.file.cueCount,
    findings: result.report.summary.total,
    fixes: result.report.fixes.length,
    jsonBytes: Buffer.byteLength(result.json),
    markdownBytes: Buffer.byteLength(result.markdown),
    csvBytes: Buffer.byteLength(result.csv),
  };
}

// 预热一轮（JIT 与缓存），不计入统计——否则首轮会被高估
once();

const samples = [];
for (let i = 0; i < runs; i += 1) samples.push(once());

const wall = samples.map((s) => s.wallMs).sort((a, b) => a - b);
const median = wall[Math.floor(wall.length / 2)];
const last = samples[samples.length - 1];

const summary = {
  sample: SAMPLE,
  sampleBytes: bytes.length,
  sampleMB: Number((bytes.length / 1024 / 1024).toFixed(2)),
  cues: last.cues,
  findings: last.findings,
  fixes: last.fixes,
  reportBytes: { json: last.jsonBytes, markdown: last.markdownBytes, csv: last.csvBytes },
  runs,
  wallMs: { min: wall[0], median, max: wall[wall.length - 1], all: wall },
  targetWallMs,
  targetMet: median <= targetWallMs,
  node: process.version,
};

if (jsonOnly) {
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  process.exit(0);
}

process.stdout.write("性能基准 · 10MB / 5000 cue 全流程（解码→解析→四域规则→报告三格式→修复）\n");
process.stdout.write("=".repeat(64) + "\n");
process.stdout.write(
  `样本: ${summary.sample}（${summary.sampleBytes} bytes / ${summary.sampleMB} MB / ${summary.cues} cue）\n`
);
process.stdout.write(
  `产出: findings ${summary.findings} / fixes ${summary.fixes} / ` +
    `json ${summary.reportBytes.json}B / md ${summary.reportBytes.markdown}B / csv ${summary.reportBytes.csv}B\n`
);
process.stdout.write(`Node: ${summary.node}；轮数 ${runs}（另有 1 轮预热，不计入）\n`);
process.stdout.write(
  `耗时: min ${wall[0].toFixed(1)}ms / 中位 ${median.toFixed(1)}ms / max ${wall[wall.length - 1].toFixed(1)}ms\n`
);
process.stdout.write(
  `对照口径 perf.targetWallMs=${targetWallMs}ms → ${summary.targetMet ? "达标（本机单次实测）" : "未达标（本机单次实测）"}\n`
);
process.stdout.write("=".repeat(64) + "\n");
process.stdout.write("注意: 这是本机单次实测值，跨机器不可比；口径键只是对照，不是硬承诺。\n");
