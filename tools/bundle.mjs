/**
 * 单文件构建的核心拼装路径（构建与测试共用，K4）。
 *
 * 纪律：
 *  - SOURCE_FILES 是显式清单，必须与 src/**\/*.js 实际集合**逐项相等**（多一个、少一个都报错）。
 *  - ruleset 由 data/ruleset.v1.json 注入，源码里不出现阈值字面量。
 *  - 模板占位符 `/*{{CSS}}*\/` 与 `/*{{JS}}*\/` 各出现恰好一次，替换后必须为零。
 *  - 输出 LF、结尾换行、无时间戳、无本机路径。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SOURCE_FILES = [
  "src/core/namespace.js",
  "src/core/ruleset.js",
  "src/core/sha256.js",
  "src/core/decode.js",
  "src/core/parse/srt.js",
  "src/core/parse/vtt.js",
  "src/core/parse/ass.js",
  "src/core/parse/index.js",
  "src/core/rules/drift.js",
  "src/core/rules/timing.js",
  "src/core/rules/readability.js",
  "src/core/rules/hygiene.js",
  "src/core/report.js",
  "src/core/fix.js",
  "src/core/pipeline.js",
  "src/ui/app.js",
];

export const TEMPLATE = "src/ui/index.html";
export const STYLE = "src/ui/app.css";
export const RULESET = "data/ruleset.v1.json";
export const OUT = "dist/subtitle-preflight.html";
export const PACKAGE = "package.json";

export function listSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) out.push(relative(ROOT, full).split("\\").join("/"));
    }
  };
  walk(join(ROOT, "src"));
  return out.sort();
}

export function checkManifest() {
  const actual = listSourceFiles();
  const declared = SOURCE_FILES.slice().sort();
  const missing = actual.filter((f) => !declared.includes(f));
  const extra = declared.filter((f) => !actual.includes(f));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push("清单缺: " + missing.join(", "));
    if (extra.length) parts.push("清单多: " + extra.join(", "));
    throw new Error("SOURCE_FILES 与 src/**/*.js 不一致 → " + parts.join("；"));
  }
  return actual.length;
}

export function readRuleset() {
  const raw = readFileSync(join(ROOT, RULESET), "utf8");
  return JSON.parse(raw);
}

/**
 * 产品版本号（代码版本，不是规则集版本）——唯一来源是 `package.json` 的 `version`。
 * 产物内版本号、README、tag 名、Release 名四处一致由这一处驱动（定版纪律）。
 */
export function readVersion() {
  const pkg = JSON.parse(readFileSync(join(ROOT, PACKAGE), "utf8"));
  if (typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error("package.json 的 version 必须是语义化三段式: " + JSON.stringify(pkg.version));
  }
  return pkg.version;
}

function rulesetModule(ruleset) {
  return (
    'SP.define("data/ruleset", [], function () {\n' +
    "  \"use strict\";\n" +
    "  return " + JSON.stringify(ruleset, null, 2).replace(/\n/g, "\n  ") + ";\n" +
    "});\n"
  );
}

export function render() {
  checkManifest();
  const ruleset = readRuleset();
  const version = readVersion();
  const template = readFileSync(join(ROOT, TEMPLATE), "utf8");
  const css = readFileSync(join(ROOT, STYLE), "utf8");

  // 顺序硬约束：namespace 必须最先（提供 SP.define），ruleset 必须在读取层之前注入。
  const jsParts = [];
  for (const rel of SOURCE_FILES) {
    if (rel === "src/core/namespace.js") {
      jsParts.push("// ---- " + rel + " ----\n" + readFileSync(join(ROOT, rel), "utf8"));
      jsParts.push(rulesetModule(ruleset));
      continue;
    }
    jsParts.push("// ---- " + rel + " ----\n" + readFileSync(join(ROOT, rel), "utf8"));
  }
  jsParts.push(
    "// ---- boot ----\n" +
      'if (typeof document !== "undefined") {\n' +
      '  SP.get("ui/app").boot();\n' +
      "}\n"
  );
  const js = jsParts.join("\n");

  const cssSlot = "/*{{CSS}}*/";
  const jsSlot = "/*{{JS}}*/";
  const versionSlot = "{{VERSION}}";
  const count = (haystack, needle) => haystack.split(needle).length - 1;
  if (count(template, cssSlot) !== 1) throw new Error("模板里 " + cssSlot + " 必须恰好出现 1 次");
  if (count(template, jsSlot) !== 1) throw new Error("模板里 " + jsSlot + " 必须恰好出现 1 次");
  if (count(template, versionSlot) !== 1) throw new Error("模板里 " + versionSlot + " 必须恰好出现 1 次");

  let html = template
    .replace(cssSlot, css.trimEnd())
    .replace(jsSlot, js.trimEnd())
    .replace(versionSlot, version);
  if (html.includes(cssSlot) || html.includes(jsSlot) || html.includes(versionSlot)) {
    throw new Error("占位符替换后仍有残留（被替换内容里含占位符？）");
  }

  html = html.replace(/\r\n/g, "\n");
  if (!html.endsWith("\n")) html += "\n";

  // 产物自检：无外部资源、无本机绝对路径
  const violations = scanForbidden(html);
  if (violations.length) throw new Error("产物自检失败: " + violations.join("；"));

  return html;
}

const EXTERNAL_PATTERNS = [
  { re: /<script[^>]+src\s*=/i, label: "外链 script" },
  { re: /<link[^>]+href\s*=/i, label: "外链 link" },
  { re: /@import\b/i, label: "CSS @import" },
  { re: /url\(\s*['"]?https?:/i, label: "CSS 远程 url()" },
  { re: /\bfetch\s*\(/, label: "fetch 调用" },
  { re: /XMLHttpRequest/, label: "XMLHttpRequest" },
  { re: /WebSocket/, label: "WebSocket" },
  { re: /sendBeacon/, label: "sendBeacon" },
  { re: /https?:\/\/[^\s"'<>)]+/i, label: "http(s) 字面量" },
  { re: /[A-Za-z]:[\\/](?:Users|Documents|Desktop)[\\/]/i, label: "本机绝对路径" },
];

export function scanForbidden(text) {
  const hits = [];
  for (const { re, label } of EXTERNAL_PATTERNS) {
    if (re.test(text)) hits.push(label);
  }
  return hits;
}
