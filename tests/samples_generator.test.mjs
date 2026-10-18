import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../tools/bundle.mjs";
import { loadCore } from "./helpers/load.mjs";
import { plant } from "../tools/samples/util.mjs";
import { assertClean, selfCheckWhitelist } from "../tools/samples/whitelist.mjs";

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: cwd || ROOT,
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

const EXCLUDE = new Set([".git", "node_modules", "dist", "out", "tmp"]);

function copyRepo() {
  const dest = mkdtempSync(join(tmpdir(), "sp-samples-"));
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

/* ---------- 生成器本体 ---------- */

test("生成器：--check 位级一致，且自报扫描量（非空跑）", () => {
  const result = run(["tools/gen-samples.mjs", "--check"]);
  assert.equal(result.code, 0, result.stdout + (result.stderr || ""));
  assert.ok(result.stdout.includes("逐字节一致"), "必须自报位级一致");
  assert.ok(result.stdout.includes("无孤儿"), "必须自报无孤儿");
  const m = /这轮比了 (\d+) \/ (\d+) 个文件/.exec(result.stdout);
  assert.ok(m, "必须自报比较文件数");
  assert.equal(m[1], m[2], "比较数必须等于计划数");
  assert.ok(Number(m[2]) >= 80, `文件数偏少（${m[2]}），扫描面可能空跑`);
});

test("生成器：样本文件按 Unicode 码点序写出且全为 LF（除 CRLF 变体）", () => {
  const result = run(["tools/gen-samples.mjs", "--list"]);
  assert.equal(result.code, 0);
  const paths = result.stdout
    .split("\n")
    .map((l) => l.trim().split(/\s{2,}/)[1])
    .filter(Boolean);
  const sorted = paths.slice().sort((a, b) => {
    const ac = Array.from(a);
    const bc = Array.from(b);
    const len = Math.min(ac.length, bc.length);
    for (let i = 0; i < len; i += 1) {
      const d = ac[i].codePointAt(0) - bc[i].codePointAt(0);
      if (d) return d;
    }
    return ac.length - bc.length;
  });
  assert.deepEqual(paths, sorted, "--list 必须按 Unicode 码点序");

  // LF：除 *-v2-crlf.* 之外，data/samples 下的文本样本都不含 CR
  const samplePaths = paths.filter((p) => p.startsWith("data/samples/"));
  const crlfSamples = samplePaths.filter((p) => p.includes("-v2-crlf."));
  assert.equal(crlfSamples.length, 3, "CRLF 变体应恰好 3 份（srt/vtt/ass）");
  for (const rel of samplePaths) {
    if (rel.includes("-v2-crlf.")) continue;
    if (rel.includes("-v6-gbk.")) continue; // GBK 字节：CR/LF 语义由字节决定
    const bytes = readFileSync(join(ROOT, rel));
    assert.equal(bytes.includes(Buffer.from("0d", "hex")), false, `${rel} 不应含 CR（应为 LF）`);
  }
});

test("生成器：篡改一个样本字节必须被 --check 抓出", () => {
  const dir = copyRepo();
  try {
    assert.equal(run(["tools/gen-samples.mjs", "--check"], dir).code, 0, "副本基线必须先绿");
    appendFileSync(join(dir, "data/samples/timing/t01-overlap.srt"), "\n", "utf8");
    const mutated = run(["tools/gen-samples.mjs", "--check"], dir);
    assert.equal(mutated.code, 1);
    assert.ok(mutated.stdout.includes("位级不一致"), "应点名位级不一致: " + mutated.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("生成器：多出一个孤儿样本必须被 --check 抓出", () => {
  const dir = copyRepo();
  try {
    writeFileSync(join(dir, "data/samples/timing/zzz-orphan.srt"), "1\n00:00:01,000 --> 00:00:02,000\nx\n", "utf8");
    const mutated = run(["tools/gen-samples.mjs", "--check"], dir);
    assert.equal(mutated.code, 1);
    assert.ok(mutated.stdout.includes("孤儿"), "应点名孤儿文件: " + mutated.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- 植入器自证与白名单 ---------- */

test("植入器自证：diff 为空必须抛错（否则样本不得计入检出率分母）", () => {
  assert.throws(() => plant("x", "同一段文本", "同一段文本"), /diff 为空/);
  const ok = plant("x", "干净基线", "植入后");
  assert.equal(ok.diffNonEmpty, true);
});

test("植入器自证：四个域每处植入都有非空 diff 记录（不是空跑）", async () => {
  const { buildFormatSamples } = await import("../tools/samples/format.mjs");
  const { buildTimingSamples } = await import("../tools/samples/timing.mjs");
  const { buildReadabilitySamples } = await import("../tools/samples/readability.mjs");
  const { buildHygieneSamples } = await import("../tools/samples/hygiene.mjs");
  const { READABILITY_RULES } = await import("../tools/samples/readabilityoracle.mjs");

  // 格式族：23 处变异（diff 非空）+ 1 处显式声明的基准形态
  const format = buildFormatSamples();
  assert.equal(format.length, 24);
  const plants = format.map((s) => s.truth.plants[0]);
  const mutations = plants.filter((p) => p.mode === "mutation");
  const baselines = plants.filter((p) => p.mode === "baseline");
  assert.equal(mutations.length, 23, "格式变体应有 23 处变异");
  assert.equal(baselines.length, 1, "ASS 厘秒是基准形态，必须显式声明而不是混进变异");
  assert.ok(mutations.every((p) => p.diffNonEmpty === true), "每处变异都必须 diff 非空");
  // 记录的数字不能是编的：至少一半变异的字节数确实与基准不同
  //（逗号↔点号、序号跳号这类替换不改长度，所以不能要求全部都不同）
  const lengthChanged = mutations.filter((p) => p.variantBytes !== p.baseBytes).length;
  assert.ok(lengthChanged >= 10, `只有 ${lengthChanged} 处变异的字节数与基准不同，记录可疑`);

  // 时序族：12 类样本各 1 处植入
  const timing = buildTimingSamples().filter((s) => s.cls !== "BASELINE");
  assert.equal(timing.length, 12);
  for (const s of timing) {
    assert.equal(s.truth.planted[0].diffNonEmpty, true, `${s.id} 植入自证缺失`);
  }

  // 可读性族：每条有正例的规则都要有"干净孪生"证明
  const readability = buildReadabilitySamples();
  for (const s of readability.samples) {
    const rules = s.truth.planted.map((p) => p.ruleId);
    assert.deepEqual(rules.slice().sort(), READABILITY_RULES.slice().sort(), `${s.fileName} 的孪生证明未覆盖全部 7 条规则`);
    assert.ok(s.truth.planted.every((p) => p.diffNonEmpty === true));
  }

  // 卫生族：10 条正例各 1 处植入
  const hygiene = buildHygieneSamples();
  assert.equal(hygiene.truth.planted.length, 10);
  assert.ok(hygiene.truth.planted.every((p) => p.diffNonEmpty === true));
  assert.equal(new Set(hygiene.truth.planted.map((p) => p.ruleId)).size, 10, "10 条规则各应有一条植入");
});

test("内容白名单：禁用词命中即抛错，且不是空跑", () => {
  assert.throws(() => assertClean("Game of Thrones S01E01", "test"), /禁用词表/);
  assert.throws(() => assertClean("这是流浪地球的台词", "test"), /禁用词表/);
  assert.equal(assertClean("示例剧·夜航 角色甲", "test"), true);
  const info = selfCheckWhitelist();
  assert.ok(info.banned > 5 && info.shows > 2);
});

/* ---------- SRT 格式样本 × 当前解析器：0 容差（M2 的桥） ---------- */

const SRAT_FIELDS = [
  "index",
  "declaredIndex",
  "startMs",
  "endMs",
  "textLines",
  "textLineNumbers",
  "sourceLine",
  "endLine",
];

function decodeSample(truth) {
  const bytes = readFileSync(join(ROOT, "data/samples", truth.sample));
  const enc = truth.encoding === "gbk" ? "gbk" : "utf-8";
  let text = new TextDecoder(enc, { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

test("格式样本（SRT 侧 8 份）：真值与当前解析器 cue 边界 / 行号映射 0 容差", () => {
  const SP = loadCore();
  const srt = SP.get("core/parse/srt");
  const dir = join(ROOT, "data/truth/format");
  const names = [
    "srt-v1-bom", "srt-v2-crlf", "srt-v3-missing-index", "srt-v4-jumped-index",
    "srt-v5-comma-dot", "srt-v6-gbk", "srt-v7-trailing-space", "srt-v8-blank-noise",
  ];
  for (const id of names) {
    const truth = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
    // 解析器契约：输入是**已归一化换行**的原文（解码层负责 CRLF/CR → LF）
    const text = decodeSample(truth).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parsed = srt.parse(text);
    assert.equal(parsed.cues.length, truth.cueCount, `${id}: cue 数不一致`);
    assert.equal(parsed.cues.length, truth.cues.length, `${id}: 真值 cues 长度不一致`);
    parsed.cues.forEach((cue, k) => {
      const expected = truth.cues[k];
      for (const field of SRAT_FIELDS) {
        assert.deepEqual(cue[field], expected[field], `${id} cue#${k + 1} 字段 ${field} 不一致`);
      }
    });
  }
});

test("格式样本（VTT / ASS 侧）：真值是 M2 目标契约，解析器当前必须显式声明未实现", () => {
  const SP = loadCore();
  const parse = SP.get("core/parse/index");
  for (const [rel, format] of [["vtt-v1-bom.vtt", "vtt"], ["ass-v1-bom.ass", "ass"]]) {
    const truth = JSON.parse(readFileSync(join(ROOT, "data/truth/format", rel.replace(/\.\w+$/, ".json")), "utf8"));
    const text = decodeSample(truth);
    const result = parse.parseText(text, rel);
    assert.equal(result.format, format, `${rel}: 格式判别错误`);
    assert.equal(result.cues.length, 0, `${rel}: 未实现时不得返回空成功之外的 cue`);
    assert.ok(result.skipped.some((s) => s.reason === "not_implemented"), `${rel}: 必须在 skipped 里显式声明`);
  }
});

test("真值文件：禁止出现 observed / actual / message（抽样 3 份深查）", () => {
  const files = [
    "data/truth/format/srt-v1-bom.json",
    "data/truth/timing/t01-overlap.json",
    "data/truth/hygiene/hygiene-golden.json",
  ];
  const deep = (value, hits, path) => {
    if (Array.isArray(value)) value.forEach((v, i) => deep(v, hits, `${path}[${i}]`));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (["observed", "actual", "message"].includes(k)) hits.push(`${path}.${k}`);
        deep(v, hits, `${path}.${k}`);
      }
    }
  };
  for (const rel of files) {
    assert.ok(existsSync(join(ROOT, rel)), "缺 " + rel);
    const hits = [];
    deep(JSON.parse(readFileSync(join(ROOT, rel), "utf8")), hits, rel);
    assert.deepEqual(hits, [], `${rel} 含观测字段`);
  }
});
