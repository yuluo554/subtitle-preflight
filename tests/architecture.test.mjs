import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT } from "../tools/bundle.mjs";
import { loadCore } from "./helpers/load.mjs";

function listJs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listJs(full, out);
    else if (entry.name.endsWith(".js")) out.push(relative(ROOT, full).split("\\").join("/"));
  }
  return out;
}

const CORE_FORBIDDEN = [
  { re: /\bdocument\./, label: "DOM（document）" },
  { re: /\bwindow\./, label: "DOM（window）" },
  { re: /\bfetch\s*\(/, label: "fetch" },
  { re: /XMLHttpRequest/, label: "XMLHttpRequest" },
  { re: /WebSocket/, label: "WebSocket" },
  { re: /sendBeacon/, label: "sendBeacon" },
  { re: /Date\.now\s*\(/, label: "时钟（Date.now）" },
  { re: /new Date\s*\(/, label: "时钟（new Date）" },
  { re: /Math\.random\s*\(/, label: "随机（Math.random）" },
  { re: /toLocaleString|localeCompare|Intl\./, label: "locale 依赖" },
];

test("架构：src/core/** 不碰 DOM / 网络 / 时钟 / 随机 / locale", () => {
  const files = listJs(join(ROOT, "src/core"));
  assert.ok(files.length >= 5, "扫描面非空自证：至少 5 个 core 文件");
  const hits = [];
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    for (const rule of CORE_FORBIDDEN) {
      if (rule.re.test(text)) hits.push(`${rel}: ${rule.label}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("架构：src/ui/** 不直接依赖规则层或口径", () => {
  const files = listJs(join(ROOT, "src/ui"));
  assert.ok(files.length >= 1);
  const hits = [];
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    if (/core\/rules\//.test(text)) hits.push(`${rel}: 直接依赖 core/rules`);
    if (/data\/ruleset/.test(text)) hits.push(`${rel}: 直接读 data/ruleset`);
  }
  assert.deepEqual(hits, []);
});

test("架构：每个 SP.define 的模块名唯一且依赖可解析", () => {
  const files = listJs(join(ROOT, "src"));
  const defined = new Map();
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    const re = /SP\.define\(\s*["']([^"']+)["']\s*,\s*\[([^\]]*)\]/g;
    let m;
    while ((m = re.exec(text))) {
      assert.equal(defined.has(m[1]), false, `模块名重复: ${m[1]}（${rel} 与 ${defined.get(m[1])}）`);
      defined.set(m[1], rel);
    }
  }
  assert.ok(defined.size >= 8, "扫描面非空自证：至少 8 个模块");
  assert.ok(defined.has("data/ruleset") === false, "data/ruleset 由构建注入，源码里不应定义");
  assert.ok(defined.has("core/pipeline"));
  assert.ok(defined.has("ui/app"));
});

test("架构：构建清单里的每个模块都在源码里被定义", () => {
  const files = listJs(join(ROOT, "src"));
  const defined = new Set();
  for (const rel of files) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    const re = /SP\.define\(\s*["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(text))) defined.add(m[1]);
  }
  const required = [
    "core/ruleset",
    "core/sha256",
    "core/decode",
    "core/parse/srt",
    "core/parse/vtt",
    "core/parse/ass",
    "core/parse/index",
    "core/rules/drift",
    "core/rules/timing",
    "core/report",
    "core/pipeline",
    "ui/app",
  ];
  for (const name of required) assert.ok(defined.has(name), "缺模块定义: " + name);
});

test("架构：能力的声明是数据结构，不只是文档", () => {
  const text = readFileSync(join(ROOT, "src/core/pipeline.js"), "utf8");
  // 每个能力域都必须在 CAPABILITIES 里显式出现——"没写"与"没实现"一样是缺口
  for (const key of [
    "srt",
    "vtt",
    "ass",
    "timing",
    "readability",
    "hygiene",
    "json",
    "markdown",
    "csv",
    "fixes",
    "driftFit",
  ]) {
    assert.ok(text.includes(key), "capabilities 缺声明: " + key);
  }
  // 声明值只能是这两种枚举，不能写自由文本（否则下游无法机读）
  assert.ok(text.includes("implemented"));
  const SP = loadCore();
  const caps = SP.get("core/pipeline").CAPABILITIES;
  const allowed = new Set(["implemented", "not_implemented"]);
  const values = [];
  for (const [key, value] of Object.entries(caps.parsers)) values.push(["parsers." + key, value]);
  for (const [key, value] of Object.entries(caps.rules)) values.push(["rules." + key, value]);
  for (const [key, value] of Object.entries(caps.exports)) values.push(["exports." + key, value]);
  values.push(["fixes", caps.fixes], ["driftFit", caps.driftFit]);
  assert.ok(values.length >= 11, "能力声明条数偏少: " + values.length);
  for (const [key, value] of values) {
    assert.ok(allowed.has(value), `${key} 的声明值不是枚举值: ${JSON.stringify(value)}`);
  }
});
