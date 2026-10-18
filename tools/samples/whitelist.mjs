/**
 * 内容白名单与禁用词表（合成数据纪律 §3.1 的可执行形态）。
 *
 * 硬约束：样本只使用**虚构名**（示例剧 / Sample Show / 角色甲 / Character A 一类），
 * 不复制任何真实影视作品名、角色名、演员名、剧本或字幕。
 * 生成器每写出一份样本前都跑 `assertClean()`，命中禁用词直接抛错（不是警告）。
 */

/** 允许的虚构剧名（前缀 + 后缀全部自造）。 */
export const SHOW_NAMES = [
  "示例剧·夜航",
  "Sample Show S01E01",
  "示例剧·回声",
  "Sample Show S02E03",
  "示例剧·沙漏",
  "Sample Show S01E07",
];

/** 允许的虚构角色名。 */
export const CHARACTERS = {
  zh: ["角色甲", "角色乙", "角色丙", "旁白"],
  en: ["Character A", "Character B", "Narrator"],
  ja: ["登場人物甲", "登場人物乙"],
};

/**
 * 禁用词表：真实影视作品名 / 角色名 / 演员名 / 常见字幕站与片源品牌。
 * 命中即抛错——这是版权红线，不是风格建议。
 */
export const BANNED = [
  // 真实影视作品（中文）
  "流浪地球", "三体", "甄嬛传", "琅琊榜", "知否", "庆余年", "陈情令",
  "权力的游戏", "绝命毒师", "怪奇物语", "老友记", "生活大爆炸",
  // 真实影视作品（英文）
  "Game of Thrones", "Breaking Bad", "Stranger Things", "The Office",
  "Friends", "The Matrix", "Inception", "Interstellar", "Pulp Fiction",
  // 真实角色名（示例性抽样）
  "Jon Snow", "Walter White", "Daenerys", "Sheldon Cooper", "Neo", "Frodo",
  // 真实演员名（示例性抽样）
  "Tom Hanks", "Morgan Freeman", "Scarlett Johansson", "Keanu Reeves",
  // 题库 / 台词库 / 字幕站品牌
  "opensubtitles", "subscene", "射手网", "字幕库", "zimuku", "assrt",
  // 真实剧本/小说片段（标识性开头）
  "To be, or not to be", "It was the best of times", "凡是有钱的单身汉",
];

/** 命中禁用词就抛错。`where` 只用于错误信息定位。 */
export function assertClean(text, where) {
  const haystack = String(text);
  const hits = BANNED.filter((word) => haystack.includes(word));
  if (hits.length) {
    throw new Error(`${where}: 内容命中禁用词表 → ${hits.join(" / ")}（版权红线，样本不得入仓）`);
  }
  return true;
}

/** 结构完整性自检：白名单与字符表都非空，防止"门在空跑"。 */
export function selfCheckWhitelist() {
  if (SHOW_NAMES.length === 0) throw new Error("SHOW_NAMES 为空");
  if (BANNED.length === 0) throw new Error("BANNED 为空（禁用词表空 = 门空跑）");
  for (const lang of ["zh", "en", "ja"]) {
    if (!CHARACTERS[lang] || CHARACTERS[lang].length === 0) throw new Error(`CHARACTERS.${lang} 为空`);
  }
  // 允许的虚构名不得命中禁用词表（否则白名单自相矛盾）
  for (const name of SHOW_NAMES) assertClean(name, "白名单自检");
  for (const lang of Object.keys(CHARACTERS)) {
    for (const name of CHARACTERS[lang]) assertClean(name, "白名单自检");
  }
  // 禁用词表命中必须真的抛错（非空跑自证：拿一个禁用词当内容试）
  let threw = false;
  try {
    assertClean("这部片子叫" + BANNED[0], "禁用词表空跑自证");
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("禁用词表形同虚设：命中时没有抛错");
  return { shows: SHOW_NAMES.length, banned: BANNED.length };
}
