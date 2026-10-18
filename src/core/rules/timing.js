/**
 * 时序规则（模块 ②）。本轮实现 T01–T10 与 T12；T11（fps 漂移）在 M3 补齐，
 * 未实现时**必须**进入 `skipped[]`，不得静默返回空。
 *
 * 输出 finding 的 `line` 取时间码所在行（`timeLine`），便于回到原文定位。
 */
SP.define("core/rules/timing", ["core/ruleset"], function (ruleset) {
  "use strict";

  const RULE_IDS = [
    "timing.overlap",
    "timing.zero-duration",
    "timing.negative-duration",
    "timing.gap-too-small",
    "timing.non-monotonic",
    "timing.duplicate-cue",
    "timing.negative-start",
    "timing.past-media-end",
    "timing.file-order-mismatch",
    "timing.timecode-precision",
  ];

  const IMPLEMENTED = new Set(RULE_IDS);

  function finding(ruleId, cue, field, expected, actual, message, severity) {
    return {
      ruleId,
      severity: severity || "error",
      line: cue.timeLine,
      field,
      expected: String(expected),
      actual: String(actual),
      message,
    };
  }

  function run(cues, options) {
    const opts = options || {};
    const findings = [];
    const skipped = [];
    const gapMin = ruleset.get("timing.gapMin");

    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      const prev = i > 0 ? cues[i - 1] : null;

      if (cue.startMs < 0) {
        findings.push(finding("timing.negative-start", cue, "startMs", ">= 0", cue.startMs, "起点为负"));
      }

      if (cue.endMs < cue.startMs) {
        findings.push(
          finding("timing.negative-duration", cue, "endMs", ">= startMs", cue.endMs, "结束早于开始")
        );
      } else if (cue.endMs === cue.startMs) {
        findings.push(
          finding("timing.zero-duration", cue, "endMs", "> startMs", cue.endMs, "时长为 0")
        );
      }

      if (prev) {
        if (cue.startMs < prev.endMs) {
          findings.push(
            finding(
              "timing.overlap",
              cue,
              "startMs",
              ">= " + prev.endMs,
              cue.startMs,
              "本条起点早于上一条结束"
            )
          );
        } else {
          const gap = cue.startMs - prev.endMs;
          if (gap < gapMin) {
            findings.push(
              finding(
                "timing.gap-too-small",
                cue,
                "startMs",
                ">= " + (prev.endMs + gapMin),
                cue.startMs,
                "与上一条的间隔小于口径下限"
              )
            );
          }
        }

        if (cue.startMs < prev.startMs) {
          findings.push(
            finding(
              "timing.non-monotonic",
              cue,
              "startMs",
              ">= " + prev.startMs,
              cue.startMs,
              "起点相对上一条倒退"
            )
          );
        }

        if (
          cue.startMs === prev.startMs &&
          cue.endMs === prev.endMs &&
          cue.textLines.join("\n") === prev.textLines.join("\n")
        ) {
          findings.push(
            finding("timing.duplicate-cue", cue, "text", "唯一", "与上一条完全相同", "重复 cue", "warn")
          );
        }
      }
    }

    // 文件顺序 ≠ 时间顺序：整段只报一条，指向首个倒退位置
    const reversed = findFirstReversal(cues);
    if (reversed) {
      findings.push(
        finding(
          "timing.file-order-mismatch",
          reversed,
          "startMs",
          "按时间升序排列",
          reversed.startMs,
          "文件顺序与时间顺序不一致",
          "warn"
        )
      );
    }

    // 越界：仅在用户声明媒体时长时执行
    const mediaDurationMs = opts.mediaDurationMs;
    if (typeof mediaDurationMs === "number" && isFinite(mediaDurationMs) && mediaDurationMs > 0) {
      let last = null;
      for (const cue of cues) {
        if (!last || cue.endMs > last.endMs) last = cue;
      }
      if (last && last.endMs > mediaDurationMs) {
        findings.push(
          finding(
            "timing.past-media-end",
            last,
            "endMs",
            "<= " + mediaDurationMs,
            last.endMs,
            "末条结束时间超过声明的媒体时长"
          )
        );
      }
    } else {
      skipped.push({ kind: "rule", ruleId: "timing.past-media-end", reason: "media_duration_unknown" });
    }

    // T12 由解析层记录诊断，规则层转成 finding
    for (const diagnostic of opts.diagnostics || []) {
      if (diagnostic.code === "parse.timecode-precision") {
        findings.push({
          ruleId: "timing.timecode-precision",
          severity: "warn",
          line: diagnostic.line,
          field: diagnostic.field || "timecode",
          expected: "3 位毫秒 / 小时位 <= 2 位",
          actual: diagnostic.detail || "非标准精度",
          message: "时间码精度不符合口径",
        });
      }
    }

    // T11 未实现：显式声明，不返回空成功
    skipped.push({ kind: "rule", ruleId: "timing.fps-drift", reason: "not_implemented" });

    return { findings, skipped, implemented: Array.from(IMPLEMENTED).sort() };
  }

  function findFirstReversal(cues) {
    for (let i = 1; i < cues.length; i += 1) {
      if (cues[i].startMs < cues[i - 1].startMs) return cues[i];
    }
    return null;
  }

  return { run, RULE_IDS, findFirstReversal };
});
