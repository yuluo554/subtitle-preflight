import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROOT, OUT, SOURCE_FILES, listSourceFiles, scanForbidden, render } from "../tools/bundle.mjs";

const outPath = join(ROOT, OUT);

test("构建：SOURCE_FILES 与 src/**/*.js 实际集合逐项相等", () => {
  const actual = listSourceFiles();
  const declared = SOURCE_FILES.slice().sort();
  assert.deepEqual(declared, actual);
});

test("构建：同一输入两次渲染逐字节一致", () => {
  assert.equal(render(), render());
});

test("构建：产物存在且与当前源码同基线", () => {
  assert.ok(existsSync(outPath), "缺 " + OUT + "（先跑 node tools/build.mjs）");
  const disk = readFileSync(outPath, "utf8");
  assert.equal(disk, render(), "产物与源码不同基线（重新构建）");
});

test("构建：产物无外链、无网络调用、无本机路径", () => {
  const html = readFileSync(outPath, "utf8");
  assert.deepEqual(scanForbidden(html), []);
});

test("构建：产物零 <script src> / <link> / @import", () => {
  const html = readFileSync(outPath, "utf8");
  assert.equal(/<script[^>]+src\s*=/i.test(html), false);
  assert.equal(/<link[^>]+href\s*=/i.test(html), false);
  assert.equal(/@import\b/i.test(html), false);
});

test("构建：模板占位符已全部替换", () => {
  const html = readFileSync(outPath, "utf8");
  assert.equal(html.includes("/*{{CSS}}*/"), false);
  assert.equal(html.includes("/*{{JS}}*/"), false);
});

test("构建：产物以 LF 结尾且无 CR", () => {
  const html = readFileSync(outPath, "utf8");
  assert.ok(html.endsWith("\n"));
  assert.equal(html.includes("\r"), false);
});

test("构建：ruleset 已注入产物，且源码里没有阈值字面量", () => {
  const html = readFileSync(outPath, "utf8");
  assert.ok(html.includes('SP.define("data/ruleset"'));
  const core = SOURCE_FILES.filter((f) => f.startsWith("src/core/")).map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
  assert.equal(/(?<![\w.])7000(?![\w.])/.test(core), false, "duration.max 不应出现在源码");
  assert.equal(/(?<![\w.])800(?![\w.])/.test(core), false, "duration.min 不应出现在源码");
});

test("构建：产物里 UI 只经 pipeline 消费，不直接读 ruleset 判定", () => {
  const ui = readFileSync(join(ROOT, "src/ui/app.js"), "utf8");
  assert.equal(ui.includes("core/rules/"), false, "UI 不得直接依赖规则层");
  assert.equal(ui.includes("data/ruleset"), false, "UI 不得直接读口径");
});
