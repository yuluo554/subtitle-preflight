/**
 * 测试加载器：把源码按构建同一条路径装进当前进程的全局 `SP` 注册表。
 *
 * 纪律（K4）：测试与构建共用 `tools/bundle.mjs` 的 `SOURCE_FILES`，
 * 测试不得自己维护第二份文件清单。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, SOURCE_FILES, readRuleset } from "../../tools/bundle.mjs";

export function loadCore() {
  delete globalThis.SP;
  const ruleset = readRuleset();
  globalThis.SP = undefined;
  // namespace 必须先定义
  const namespaceCode = readFileSync(join(ROOT, "src/core/namespace.js"), "utf8");
  new Function(namespaceCode)();

  globalThis.SP.define("data/ruleset", [], function () {
    return ruleset;
  });

  for (const rel of SOURCE_FILES) {
    if (rel === "src/core/namespace.js") continue;
    const code = readFileSync(join(ROOT, rel), "utf8");
    new Function(code)();
  }
  return globalThis.SP;
}

export function encode(text) {
  return new TextEncoder().encode(text);
}

export function fileOf(name, text) {
  return { name, bytes: encode(text) };
}

export function cue(startMs, endMs, textLines, extra) {
  return Object.assign(
    {
      index: 1,
      declaredIndex: null,
      startMs,
      endMs,
      textLines: textLines || ["示例台词"],
      textLineNumbers: [1],
      format: "srt",
      sourceLine: 1,
      endLine: 1,
      timeLine: 1,
    },
    extra || {}
  );
}
