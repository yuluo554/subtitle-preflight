/**
 * 时序缺陷样本（12 类，每类 ≥ 1 份）+ 真值。
 *
 * 结构：先建**干净基线**（8 条 cue，全部合规），每个样本 = 基线 + 一处显式植入。
 * 植入器自证：`plant()` 断言干净基线里没有这个缺陷（diff 非空），
 * 否则该样本不得计入检出率分母（plan/04 §三.7）。
 *
 * 真值只写 `ruleId` + `line`（必要时 `field`）；不写 observed / actual / message。
 */
import { assertClean } from "./whitelist.mjs";
import { buildSrt, annotateSrtLines } from "./srtbuild.mjs";
import { runTimingOracle, CLASS_RULE, TIMING_CLASSES } from "./timingoracle.mjs";
import { plant } from "./util.mjs";

/* ---------- 干净基线 ---------- */

const CLEAN_SPECS = [
  { startMs: 1000, endMs: 2500, text: ["角色甲：夜航开始了。"] },
  { startMs: 2600, endMs: 4000, text: ["角色乙：灯塔在哪边？"] },
  { startMs: 4100, endMs: 5600, text: ["角色甲：跟着浪走。"] },
  { startMs: 5700, endMs: 7200, text: ["角色乙：风比昨天大。"] },
  { startMs: 7300, endMs: 8800, text: ["角色甲：前面有礁石。"] },
  { startMs: 8900, endMs: 10400, text: ["角色乙：把帆收一半。"] },
  { startMs: 10500, endMs: 12000, text: ["角色甲：明白。"] },
  { startMs: 12100, endMs: 13600, text: ["旁白：这是示例剧的第一集。"] },
];

function clone(specs) {
  return specs.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text.slice() }));
}

function withIndex(specs) {
  return specs.map((s, k) => Object.assign({ declaredIndex: k + 1 }, s));
}

const CLEAN_LINES = buildSrt(withIndex(CLEAN_SPECS)).lines;

/* ---------- 12 类样本 ---------- */

/* 漂移样本声明的两端 fps（输入参数，不是观测值） */
const DRIFT_FPS = { declared: 23.976, playback: 25 };

const CASES = [
  {
    id: "t01-overlap",
    cls: "T01",
    note: "第 2 条起点早于第 1 条结束（1500 < 2500）",
    mutant: (s) => {
      s[1].startMs = 1500;
    },
  },
  {
    id: "t02-zero-duration",
    cls: "T02",
    note: "第 3 条 end == start",
    mutant: (s) => {
      s[2].endMs = s[2].startMs;
    },
  },
  {
    id: "t03-negative-duration",
    cls: "T03",
    note: "第 4 条 end < start",
    mutant: (s) => {
      s[3].endMs = s[3].startMs - 500;
    },
  },
  {
    id: "t04-gap-too-small",
    cls: "T04",
    note: "第 2 条与第 1 条间隔 79ms（口径下限 80ms）",
    mutant: (s) => {
      s[1].startMs = s[0].endMs + 79;
    },
  },
  {
    id: "t05-non-monotonic",
    cls: "T05",
    note: "第 3 条起点（2000）早于第 2 条起点（2600）；时间倒退必然同时构成与第 2 条的重叠（coFindings 已列明）",
    mutant: (s) => {
      s[2].startMs = 2000;
      s[2].endMs = 2400;
    },
  },
  {
    id: "t06-duplicate-cue",
    cls: "T06",
    note: "第 2 条与第 1 条起止与文本完全相同",
    mutant: (s) => {
      s[1].startMs = s[0].startMs;
      s[1].endMs = s[0].endMs;
      s[1].text = s[0].text.slice();
    },
  },
  {
    id: "t07-negative-start",
    cls: "T07",
    note: "第 1 条起点为负",
    mutant: (s) => {
      s[0].startMs = -500;
      s[0].endMs = 800;
    },
  },
  {
    id: "t08-past-media-end",
    cls: "T08",
    note: "末条结束 15000ms 超过声明媒体时长 12000ms",
    mediaDurationMs: 12000,
    mutant: (s) => {
      s[7].endMs = 15000;
    },
  },
  {
    id: "t09-unparsable-timecode",
    cls: "T09",
    note: "第 2 块时间码缺毫秒段",
    linePlant: true,
    mutateLines: (lines) => {
      const out = lines.slice();
      const idx = out.indexOf("00:00:02,600 --> 00:00:04,000");
      if (idx < 0) throw new Error("T09: 找不到第 2 条时间行");
      out[idx] = "00:00:02 --> 00:00:04";
      return out;
    },
  },
  {
    id: "t10-file-order-mismatch",
    cls: "T10",
    note: "两处倒退（第 2、4 位），验证 file-order-mismatch 整段只报一条",
    mutant: (s) => {
      const reordered = [s[0], s[7], s[1], s[6], s[2], s[3], s[4], s[5]];
      reordered.forEach((cue, k) => {
        s[k] = cue;
      });
    },
  },
  {
    id: "t11-fps-drift",
    cls: "T11",
    note: "25fps 素材按 23.976fps 播放：scale≈1.0427，全段线性漂移",
    drift: true,
    fps: DRIFT_FPS,
    mutant: (s) => {
      const scale = DRIFT_FPS.playback / DRIFT_FPS.declared;
      for (const cue of s) {
        cue.startMs = Math.round(cue.startMs * scale);
        cue.endMs = Math.round(cue.endMs * scale);
      }
    },
  },
  {
    id: "t12-timecode-precision",
    cls: "T12",
    note: "第 1 条毫秒位写成 2 位",
    linePlant: true,
    mutateLines: (lines) => {
      const out = lines.slice();
      const idx = out.indexOf("00:00:01,000 --> 00:00:02,500");
      if (idx < 0) throw new Error("T12: 找不到第 1 条时间行");
      out[idx] = "00:00:01,00 --> 00:00:02,500";
      return out;
    },
  },
];

/* ---------- 行序列 → cue 序列（含坏时间码的 unparsable 占位） ---------- */

function cuesFromLines(lines) {
  const cues = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }
    let timeLineIdx = i;
    if (/^\s*\d+\s*$/.test(lines[i]) && i + 1 < lines.length) timeLineIdx = i + 1;
    const candidate = lines[timeLineIdx];
    const m =
      /^\s*(-)?(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,4})\s*-->\s*(-)?(\d{1,4}):(\d{1,2}):(\d{1,2})[,.](\d{1,4})/.exec(
        candidate
      );
    let j = timeLineIdx + 1;
    while (j < lines.length && lines[j].trim() !== "") j += 1;
    const textLines = lines.slice(timeLineIdx + 1, j);
    if (!m) {
      cues.push({ timeLine: timeLineIdx + 1, unparsable: true, textLines });
      i = j;
      continue;
    }
    const toMs = (sign, h, mi, s, f) => {
      const value = Number(h) * 3600000 + Number(mi) * 60000 + Number(s) * 1000 + Number(f.padEnd(3, "0"));
      return sign ? -value : value;
    };
    cues.push({
      startMs: toMs(m[1], m[2], m[3], m[4], m[5]),
      endMs: toMs(m[6], m[7], m[8], m[9], m[10]),
      textLines,
      timeLine: timeLineIdx + 1,
      timecodeText: candidate,
    });
    i = j;
  }
  return cues;
}

/* ---------- 组装 ---------- */

export function buildTimingSamples() {
  const samples = [];

  // 0) 干净基线（"误报 0"的对照；不植入任何缺陷）
  {
    const text = CLEAN_LINES.join("\n") + "\n";
    for (const line of CLEAN_LINES) assertClean(line, "timing-clean-baseline");
    const cues = cuesFromLines(CLEAN_LINES);
    const oracle = runTimingOracle(cues, { mediaDurationMs: 60000 });
    if (oracle.findings.length !== 0) {
      throw new Error("干净基线居然有 finding: " + JSON.stringify(oracle.findings));
    }
    samples.push({
      id: "timing-clean-baseline",
      cls: "BASELINE",
      ruleId: null,
      fileName: "timing-clean-baseline.srt",
      text,
      truth: {
        sample: "timing/timing-clean-baseline.srt",
        class: "BASELINE",
        note: "8 条合规 cue，用于误报对照",
        mediaDurationMs: 60000,
        expectFindings: [],
        expectNoFindings: [
          { ruleId: "timing.overlap", why: "干净基线：相邻 cue 首尾不重叠" },
          { ruleId: "timing.gap-too-small", why: "干净基线：最小间隔 100ms >= 口径下限" },
          { ruleId: "timing.duplicate-cue", why: "干净基线：8 条文本互不相同" },
        ],
        planted: [],
      },
    });
  }

  for (const spec of CASES) {
    let mutantLines;
    if (spec.linePlant) {
      mutantLines = spec.mutateLines(CLEAN_LINES);
      plant(spec.id, CLEAN_LINES.join("\n"), mutantLines.join("\n"));
    } else {
      const mutantSpecs = clone(CLEAN_SPECS);
      spec.mutant(mutantSpecs);
      mutantLines = buildSrt(withIndex(mutantSpecs)).lines;
      plant(spec.id, CLEAN_LINES.join("\n"), mutantLines.join("\n"));
    }

    const text = mutantLines.join("\n") + "\n";
    for (const line of mutantLines) assertClean(line, spec.id);

    const cues = cuesFromLines(mutantLines);
    const oracle = runTimingOracle(cues, spec.mediaDurationMs ? { mediaDurationMs: spec.mediaDurationMs } : {});
    const ruleId = CLASS_RULE[spec.cls];

    // T11 尚未实现（M3）：真值里写"应报"，但独立判定式本轮不会产出它。
    // 其余 11 类必须能被独立复算，否则真值不可信。
    if (spec.cls === "T11") {
      const cleanOracle = runTimingOracle(cuesFromLines(CLEAN_LINES), {});
      if (cleanOracle.findings.some((f) => f.ruleId === "timing.fps-drift")) {
        throw new Error("T11: 干净基线不应产出 fps-drift");
      }
    } else if (!oracle.findings.some((f) => f.ruleId === ruleId)) {
      throw new Error(`${spec.id}: 植入后独立判定式没有产出 ${ruleId}（真值不可复算）`);
    }

    // 标注器与行扫描必须对"可解析块"给出一致的 cue 数（行号映射的差分对照）
    const annotated = annotateSrtLines(mutantLines);
    const parsable = cues.filter((c) => !c.unparsable).length;
    if (annotated.cues.length !== parsable) {
      throw new Error(`${spec.id}: 标注 cue 数 ${annotated.cues.length} ≠ 行扫描 ${parsable}`);
    }

    // 期望 = 独立判定式的**全部**输出（不只本类规则）——真值必须完整，
    // 否则 M3 多报一条就会被误判成"误报"。`primaryRuleId` 标明本样本的植入类。
    const expectFindings = oracle.findings.map((f) => {
      const item = { ruleId: f.ruleId, line: f.line };
      if (f.field) item.field = f.field;
      return item;
    });
    if (spec.cls === "T11") {
      // T11 未实现（M3）：按 plan/03 §二 的表写明期望（line=1, field=fit）
      expectFindings.unshift({ ruleId: "timing.fps-drift", line: 1, field: "fit" });
    }

    const truth = {
      sample: "timing/" + spec.id + ".srt",
      class: spec.cls,
      primaryRuleId: ruleId,
      note: spec.note,
      expectFindings,
      planted: [{ id: spec.id, cls: spec.cls, ruleId, diffNonEmpty: true }],
    };
    if (spec.mediaDurationMs) truth.mediaDurationMs = spec.mediaDurationMs;
    if (spec.drift) {
      truth.fps = spec.fps;
      truth.expectedFit = {
        scale: Number((DRIFT_FPS.playback / DRIFT_FPS.declared).toFixed(6)),
        offsetMs: 0,
        residualMaxMs: 40,
        note: "M3 验收：复原 scale 误差 < 1 帧；offset 近似 0",
      };
    }
    if (spec.cls === "T11") {
      truth.implementationStatus = "pending-M3";
      truth.skippedDeclaration = { ruleId: "timing.fps-drift", reason: "not_implemented" };
    }

    samples.push({ id: spec.id, cls: spec.cls, ruleId, fileName: spec.id + ".srt", text, truth });
  }

  return samples;
}

export { TIMING_CLASSES };
