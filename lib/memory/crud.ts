import { prisma } from "@/lib/prisma";
import { nanoid } from "@/lib/utils";
import type { UserMemoryData, PairMemoryData, MusicDNA, GameSnapshot } from "./types";
import { makePairId } from "./userIdentity";

// ──────────────────────────────────────────────
// UserMemory
// ──────────────────────────────────────────────

export async function getUserMemory(userId: string): Promise<UserMemoryData | null> {
  if (!userId) return null;
  try {
    const row = await prisma.userMemory.findUnique({ where: { userId } });
    if (!row) return null;

    const dna: MusicDNA | undefined = row.musicDNA ? JSON.parse(row.musicDNA) : undefined;
    const lastSong = dna?.songs?.at(-1);

    return {
      userId: row.userId,
      gamesPlayed: row.gamesPlayed,
      nickname: row.nickname ?? undefined,
      musicDNA: dna,
      usedTopics: row.usedTopics ? JSON.parse(row.usedTopics) : [],
      lastSong: lastSong?.songName,
      lastArtist: lastSong?.artist,
    };
  } catch {
    return null;
  }
}

export async function upsertUserMemory(
  userId: string,
  nickname: string,
  newSong: { songName: string; artist: string; topic: string },
  newKeywords: string[],
  newStyles: string[]
): Promise<void> {
  if (!userId) return;

  const existing = await prisma.userMemory.findUnique({ where: { userId } });
  const prevDNA: MusicDNA = existing?.musicDNA
    ? JSON.parse(existing.musicDNA)
    : { styles: [], keywords: [], songs: [] };

  const prevTopics: string[] = existing?.usedTopics
    ? JSON.parse(existing.usedTopics)
    : [];

  // 合并风格标签（去重，最多保留 10 个）
  const mergedStyles = Array.from(new Set([...prevDNA.styles, ...newStyles])).slice(0, 10);

  // 合并关键词（去重，最多保留 20 个）
  const mergedKeywords = Array.from(new Set([...prevDNA.keywords, ...newKeywords])).slice(0, 20);

  // 追加选歌记录（最多保留最近 10 首）
  const newSongRecord = { ...newSong, date: new Date().toISOString() };
  const mergedSongs = [...prevDNA.songs, newSongRecord].slice(-10);

  // 追加用过的主题（去重）
  const mergedTopics = Array.from(new Set([...prevTopics, newSong.topic]));

  const updatedDNA: MusicDNA = {
    styles: mergedStyles,
    keywords: mergedKeywords,
    songs: mergedSongs,
  };

  await prisma.userMemory.upsert({
    where: { userId },
    create: {
      id: nanoid(),
      userId,
      nickname,
      gamesPlayed: 1,
      musicDNA: JSON.stringify(updatedDNA),
      usedTopics: JSON.stringify(mergedTopics),
    },
    update: {
      nickname,
      gamesPlayed: { increment: 1 },
      musicDNA: JSON.stringify(updatedDNA),
      usedTopics: JSON.stringify(mergedTopics),
      updatedAt: new Date(),
    },
  });
}

// ──────────────────────────────────────────────
// PairMemory
// ──────────────────────────────────────────────

export async function getPairMemory(
  userIdA: string,
  userIdB: string
): Promise<PairMemoryData | null> {
  const pairId = makePairId(userIdA, userIdB);
  if (!pairId) return null;

  try {
    const row = await prisma.pairMemory.findUnique({ where: { pairId } });
    if (!row) return null;

    const history: GameSnapshot[] = row.gameHistory ? JSON.parse(row.gameHistory) : [];
    return {
      pairId: row.pairId,
      gamesPlayed: row.gamesPlayed,
      gameHistory: history,
      relationTags: row.relationTags ? JSON.parse(row.relationTags) : [],
      cumulativeMood: row.cumulativeMood ? JSON.parse(row.cumulativeMood) : [],
      lastGame: history.at(-1),
    };
  } catch {
    return null;
  }
}

export async function upsertPairMemory(
  userIdA: string,
  userIdB: string,
  snapshot: GameSnapshot,
  newMoodKeywords: string[],
  newRelationTags: string[]
): Promise<void> {
  const pairId = makePairId(userIdA, userIdB);
  if (!pairId) return;

  const existing = await prisma.pairMemory.findUnique({ where: { pairId } });

  const prevHistory: GameSnapshot[] = existing?.gameHistory
    ? JSON.parse(existing.gameHistory)
    : [];
  const prevMood: string[] = existing?.cumulativeMood
    ? JSON.parse(existing.cumulativeMood)
    : [];
  const prevTags: string[] = existing?.relationTags
    ? JSON.parse(existing.relationTags)
    : [];

  const mergedHistory = [...prevHistory, snapshot].slice(-10); // 最多保留 10 局
  const mergedMood = Array.from(new Set([...prevMood, ...newMoodKeywords])).slice(0, 15);
  const mergedTags = Array.from(new Set([...prevTags, ...newRelationTags])).slice(0, 10);

  await prisma.pairMemory.upsert({
    where: { pairId },
    create: {
      id: nanoid(),
      pairId,
      gamesPlayed: 1,
      gameHistory: JSON.stringify(mergedHistory),
      cumulativeMood: JSON.stringify(mergedMood),
      relationTags: JSON.stringify(mergedTags),
      updatedAt: new Date(),
    },
    update: {
      gamesPlayed: { increment: 1 },
      gameHistory: JSON.stringify(mergedHistory),
      cumulativeMood: JSON.stringify(mergedMood),
      relationTags: JSON.stringify(mergedTags),
      updatedAt: new Date(),
    },
  });
}

// ──────────────────────────────────────────────
// 构建注入 Prompt 的记忆摘要文字
// ──────────────────────────────────────────────

export function buildMemoryContextSummary(
  memA: UserMemoryData | null,
  memB: UserMemoryData | null,
  pair: PairMemoryData | null
): string {
  const parts: string[] = [];

  if (pair?.gamesPlayed) {
    parts.push(`这是两人第 ${pair.gamesPlayed + 1} 次一起玩。`);
    const last = pair.lastGame;
    if (last) {
      parts.push(
        `上次（${last.date.slice(0, 10)}）主题是 ${last.topicA}/${last.topicB}，` +
        `分别选了《${last.songA.name}》和《${last.songB.name}》。`
      );
    }
    if (pair.cumulativeMood.length > 0) {
      parts.push(`两人积累的氛围词：${pair.cumulativeMood.slice(0, 5).join("、")}。`);
    }
  }

  if (memA?.musicDNA?.styles?.length) {
    parts.push(`参与者A偏好风格：${memA.musicDNA.styles.slice(0, 3).join("、")}。`);
  }
  if (memB?.musicDNA?.styles?.length) {
    parts.push(`参与者B偏好风格：${memB.musicDNA.styles.slice(0, 3).join("、")}。`);
  }

  return parts.join("") || "";
}
