/**
 * 口径读取层：全部阈值来自 data/ruleset.v1.json（构建时注入为 data/ruleset 模块）。
 * 源码里不得出现阈值字面量——由 tools/check-ruleset.mjs 的字面量扫描与
 * tests/architecture.test.mjs 的架构扫描共同守门。
 */
SP.define("core/ruleset", ["data/ruleset"], function (raw) {
  "use strict";

  const RULESET = raw;

  function get(key) {
    if (!Object.prototype.hasOwnProperty.call(RULESET, key)) {
      throw new Error("未知口径键: " + key);
    }
    return RULESET[key];
  }

  return {
    get,
    raw: RULESET,
    version: RULESET["report.rulesetVersion"],
    schemaVersion: RULESET["report.schemaVersion"],
    sortKeys: RULESET["report.sortKeys"].slice(),
  };
});
