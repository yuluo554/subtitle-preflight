/**
 * 最小模块注册表。
 * 浏览器与 Node 测试共用同一条执行路径：源码是经典脚本，不是 ESM。
 * 依赖按需解析（懒加载），因此文件顺序只影响定义，不影响求值。
 */
(function (root) {
  "use strict";

  const registry = new Map();
  const loading = new Set();

  function define(name, deps, factory) {
    if (registry.has(name)) throw new Error("重复定义模块: " + name);
    if (!Array.isArray(deps)) throw new Error("模块依赖必须是数组: " + name);
    registry.set(name, { deps: deps.slice(), factory, value: undefined, resolved: false });
  }

  function get(name) {
    const mod = registry.get(name);
    if (!mod) throw new Error("未知模块: " + name);
    if (mod.resolved) return mod.value;
    if (loading.has(name)) throw new Error("循环依赖: " + name);
    loading.add(name);
    try {
      const args = mod.deps.map(get);
      mod.value = mod.factory.apply(null, args);
      mod.resolved = true;
      return mod.value;
    } finally {
      loading.delete(name);
    }
  }

  function has(name) {
    return registry.has(name);
  }

  function names() {
    return Array.from(registry.keys()).sort();
  }

  root.SP = { define, get, has, names };
})(typeof globalThis !== "undefined" ? globalThis : this);
