import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { ROOT, OUT, SOURCE_FILES } from "../tools/bundle.mjs";

const html = readFileSync(join(ROOT, OUT), "utf8");
const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));

/** 在**产物脚本**上跑，不碰 src/ ——这才是"用户双击打开的那个文件"的证据。 */
function loadArtifact() {
  const sandbox = { console, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Map, Set };
  sandbox.globalThis = sandbox;
  runInNewContext(script, sandbox, { filename: "subtitle-preflight.html" });
  return sandbox.SP;
}

test("产物 e2e：脚本可执行，模块注册表完整", () => {
  const SP = loadArtifact();
  const names = SP.names();
  assert.ok(names.includes("data/ruleset"));
  assert.ok(names.includes("core/pipeline"));
  assert.ok(names.includes("ui/app"));
  assert.ok(names.length >= 9, `模块数偏少: ${names.join(", ")}`);
});

test("产物 e2e：在产物上跑一次完整体检", () => {
  const SP = loadArtifact();
  const text = [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "第一行",
    "",
    "2",
    "00:00:02,000 --> 00:00:04,000",
    "重叠",
    "",
  ].join("\n");
  const outcome = SP.get("core/pipeline").run(
    [{ name: "a.srt", bytes: new TextEncoder().encode(text) }],
    {}
  );
  const report = outcome.results[0].report;
  assert.equal(report.summary.total >= 1, true);
  assert.ok(report.findings.some((f) => f.ruleId === "timing.overlap"));
  assert.equal(report.rulesetVersion, 1);
});

test("产物 e2e：产物里的 ruleset 与仓库镜像逐值一致", () => {
  const SP = loadArtifact();
  const injected = SP.get("data/ruleset");
  const mirror = JSON.parse(readFileSync(join(ROOT, "data/ruleset.v1.json"), "utf8"));
  // 跨 realm 对象原型不同，用 JSON 往返比较值（键序也一并固定）
  assert.equal(JSON.stringify(injected), JSON.stringify(mirror));
});

test("产物 e2e：未实现能力在产物里也是数据（不是文档）", () => {
  const SP = loadArtifact();
  const caps = SP.get("core/pipeline").CAPABILITIES;
  // 三种解析器已在 M2 实现
  assert.equal(caps.parsers.srt, "implemented");
  assert.equal(caps.parsers.vtt, "implemented");
  assert.equal(caps.parsers.ass, "implemented");
  assert.equal(caps.rules.readability, "not_implemented");
  assert.equal(caps.rules.hygiene, "not_implemented");
  assert.equal(caps.exports.markdown, "not_implemented");
  assert.equal(caps.exports.csv, "not_implemented");
  assert.equal(caps.fixes, "not_implemented");
});

test("产物 e2e：VTT / ASS 在产物里能真的解析出 cue（不是只改了声明）", () => {
  const SP = loadArtifact();
  const pipeline = SP.get("core/pipeline");
  const enc = (s) => new TextEncoder().encode(s);
  const vtt = "WEBVTT\n\ncue-1\n00:00:01.000 --> 00:00:02.000\nhello\n";
  const ass = "[Script Info]\nTitle: t\n\n[Events]\nFormat: Layer, Start, End, Style, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,hi\n";
  const out = pipeline.run(
    [{ name: "a.vtt", bytes: enc(vtt) }, { name: "b.ass", bytes: enc(ass) }],
    {}
  );
  const byName = Object.fromEntries(out.results.map((r) => [r.file.name, r]));
  assert.equal(byName["a.vtt"].file.format, "vtt");
  assert.equal(byName["a.vtt"].file.cueCount, 1);
  assert.equal(byName["b.ass"].file.format, "ass");
  assert.equal(byName["b.ass"].file.cueCount, 1);
  assert.equal(byName["b.ass"].cues[0].startMs, 1000);
});

test("产物 e2e：UI 引用的每个元素 id 都存在于模板里", () => {
  const ui = readFileSync(join(ROOT, "src/ui/app.js"), "utf8");
  const ids = new Set();
  const re = /\$\("([a-z0-9-]+)"\)/g;
  let m;
  while ((m = re.exec(ui))) ids.add(m[1]);
  assert.ok(ids.size >= 8, `UI 引用 id 偏少: ${ids.size}`);
  const missing = [...ids].filter((id) => !new RegExp(`id="${id}"`).test(html));
  assert.deepEqual(missing, [], "UI 引用了模板里不存在的 id: " + missing.join(", "));
});

test("产物 e2e：UI 的按钮/输入控件都在模板里且不是全部禁用", () => {
  const template = readFileSync(join(ROOT, "src/ui/index.html"), "utf8");
  for (const id of ["export-json", "export-merged", "analyze-paste", "clear", "media-duration"]) {
    assert.ok(new RegExp(`id="${id}"`).test(template), "缺控件: " + id);
  }
  // 已实现的导出按钮不得带 disabled
  const jsonBtn = template.match(/<button id="export-json"[^>]*>/)[0];
  assert.equal(jsonBtn.includes("disabled"), false);
});

test("产物 e2e：产物里没有外部资源引用（含 CSS 注释也不提远程样式导入）", () => {
  assert.equal(/<script[^>]+src\s*=/i.test(html), false);
  assert.equal(/<link[^>]+href\s*=/i.test(html), false);
  assert.equal(/@import/i.test(html), false);
  assert.equal(/https?:\/\//i.test(html), false);
  assert.equal(/url\(\s*['"]?https?:/i.test(html), false);
});

test("产物 e2e：产物里的模块源码与 src/ 逐文件同源（防注入旧代码）", () => {
  for (const rel of SOURCE_FILES) {
    const code = readFileSync(join(ROOT, rel), "utf8").trim();
    assert.ok(script.includes(code), `产物里缺少或改动了 ${rel}`);
  }
});
