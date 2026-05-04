/**
 * V4 完整 LangGraph
 *
 * loadMemoryNode → analyzeChatNode → generateTopicsNode
 *       ↓
 *  [interrupt: 等待双方抽签]
 *       ↓
 *  [interrupt: 等待双方提交歌曲]
 *       ↓
 *  generateSummaryNode（注入记忆上下文）
 *       ↓
 *  updateMemoryNode（静默写入记忆）→ END
 */

import { Annotation, StateGraph, START, END, interrupt } from "@langchain/langgraph";
import { analyzeChatNode, generateTopicsNode, generateSummaryNode } from "./nodes";
import { getCheckpointer } from "./checkpointer";
import type {
  PersonalityProfile,
  RelationshipAnalysis,
  ExecutionLogEntry,
  NextSongRecommendation,
  ParticipantForSummary,
} from "./state";
import type { UserMemoryData, PairMemoryData } from "@/lib/memory/types";
import {
  getUserMemory,
  getPairMemory,
  upsertUserMemory,
  upsertPairMemory,
  buildMemoryContextSummary,
} from "@/lib/memory/crud";
import type { GameSnapshot } from "@/lib/memory/types";

// ──────────────────────────────────────────────
// V4 完整游戏状态 Annotation
// ──────────────────────────────────────────────

export const FullGameAnnotation = Annotation.Root({
  // ── 分析阶段输入 ──────────────────────────────
  chatText: Annotation<string | undefined>({ value: (_p, n) => n, default: () => undefined }),
  moodHint: Annotation<string | undefined>({ value: (_p, n) => n, default: () => undefined }),
  hostConversationSummary: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  roomName: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  roomId: Annotation<string>({ value: (_p, n) => n, default: () => "" }),

  // ── V4 记忆系统输入 ───────────────────────────
  userIdA: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  userIdB: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  nicknameA: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  nicknameB: Annotation<string>({ value: (_p, n) => n, default: () => "" }),

  // ── 记忆节点输出 ──────────────────────────────
  userMemories: Annotation<UserMemoryData[]>({ value: (_p, n) => n, default: () => [] }),
  pairMemory: Annotation<PairMemoryData | undefined>({ value: (_p, n) => n, default: () => undefined }),
  memoryContextSummary: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  usedTopics: Annotation<string[]>({ value: (_p, n) => n, default: () => [] }),

  // ── 分析阶段输出 ──────────────────────────────
  personalityProfiles: Annotation<PersonalityProfile[]>({ value: (_p, n) => n, default: () => [] }),
  relationshipAnalysis: Annotation<RelationshipAnalysis | undefined>({ value: (_p, n) => n, default: () => undefined }),
  extractedMood: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  extractedKeywords: Annotation<string[]>({ value: (_p, n) => n, default: () => [] }),
  topics: Annotation<string[]>({ value: (_p, n) => n, default: () => [] }),
  topicSource: Annotation<"default" | "ai">({ value: (_p, n) => n, default: () => "default" as const }),

  // ── Human-in-the-loop 数据 ────────────────────
  participants: Annotation<ParticipantForSummary[]>({ value: (_p, n) => n, default: () => [] }),

  // ── 总结阶段输出 ──────────────────────────────
  summary: Annotation<string | undefined>({ value: (_p, n) => n, default: () => undefined }),
  tags: Annotation<string[] | undefined>({ value: (_p, n) => n, default: () => undefined }),
  nextSongRecommendation: Annotation<NextSongRecommendation | undefined>({ value: (_p, n) => n, default: () => undefined }),

  // ── 执行日志（追加模式） ───────────────────────
  executionLog: Annotation<ExecutionLogEntry[]>({
    value: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // ── 阶段标志 ─────────────────────────────────
  phase: Annotation<string>({ value: (_p, n) => n, default: () => "init" }),
});

export type FullGameState = typeof FullGameAnnotation.State;

// ──────────────────────────────────────────────
// loadMemoryNode：加载双方历史记忆
// ──────────────────────────────────────────────

async function loadMemoryNode(
  state: FullGameState
): Promise<Partial<FullGameState>> {
  const start = new Date();

  if (!state.userIdA && !state.userIdB) {
    return {
      phase: "memory_loaded",
      executionLog: [makeLog("loadMemoryNode", "route", start, new Date(), "无用户ID，跳过记忆加载")],
    };
  }

  try {
    const [memA, memB, pair] = await Promise.all([
      getUserMemory(state.userIdA),
      getUserMemory(state.userIdB),
      getPairMemory(state.userIdA, state.userIdB),
    ]);

    const contextSummary = buildMemoryContextSummary(memA, memB, pair);
    const usedTopics = [
      ...(memA?.usedTopics ?? []),
      ...(memB?.usedTopics ?? []),
    ];
    const end = new Date();

    return {
      userMemories: [memA, memB].filter(Boolean) as UserMemoryData[],
      pairMemory: pair ?? undefined,
      memoryContextSummary: contextSummary,
      usedTopics: Array.from(new Set(usedTopics)),
      phase: "memory_loaded",
      executionLog: [
        makeLog(
          "loadMemoryNode",
          "llm",
          start,
          end,
          pair?.gamesPlayed
            ? `记忆加载：第 ${pair.gamesPlayed + 1} 局，上次 ${pair.lastGame?.date?.slice(0, 10) ?? "未知"}`
            : "首次相遇，初始化记忆"
        ),
      ],
    };
  } catch (e) {
    console.error("[loadMemoryNode] 失败:", e);
    return {
      phase: "memory_loaded",
      executionLog: [makeLog("loadMemoryNode", "route", start, new Date(), "记忆加载失败，继续执行")],
    };
  }
}

// ──────────────────────────────────────────────
// 分析节点适配器（注入记忆上下文）
// ──────────────────────────────────────────────

async function fullAnalyzeChatNode(state: FullGameState): Promise<Partial<FullGameState>> {
  const result = await analyzeChatNode(state as Parameters<typeof analyzeChatNode>[0]);
  return { ...result, phase: "topics_generating" };
}

async function fullGenerateTopicsNode(state: FullGameState): Promise<Partial<FullGameState>> {
  // 把记忆上下文和已用主题传入 state（generateTopicsNode 会读取 hostConversationSummary 等字段）
  const enrichedState = {
    ...state,
    hostConversationSummary: [
      state.hostConversationSummary,
      state.memoryContextSummary,
    ].filter(Boolean).join("。"),
  };
  const result = await generateTopicsNode(
    enrichedState as Parameters<typeof generateTopicsNode>[0]
  );

  // 过滤掉已用过的主题
  const filteredTopics = (result.topics ?? []).filter(
    (t) => !state.usedTopics.includes(t)
  );
  const finalTopics = filteredTopics.length >= 8 ? filteredTopics : result.topics ?? [];

  return { ...result, topics: finalTopics, phase: "topics_ready" };
}

// ──────────────────────────────────────────────
// interrupt 节点 1：等待双方抽签
// ──────────────────────────────────────────────

async function waitForDrawsNode(state: FullGameState): Promise<Partial<FullGameState>> {
  const start = new Date();
  const resumed = interrupt({ reason: "waiting_for_draws" });
  const end = new Date();
  return {
    phase: "drawing",
    participants: (resumed as { participants?: ParticipantForSummary[] }).participants ?? [],
    executionLog: [makeLog("waitForDrawsNode", "human", start, end, "等待双方抽签（Human-in-the-loop）")],
  };
}

// ──────────────────────────────────────────────
// interrupt 节点 2：等待双方提交歌曲
// ──────────────────────────────────────────────

async function waitForEntriesNode(state: FullGameState): Promise<Partial<FullGameState>> {
  const start = new Date();
  const resumed = interrupt({ reason: "waiting_for_entries" });
  const end = new Date();
  const updatedParticipants =
    (resumed as { participants?: ParticipantForSummary[] }).participants ?? state.participants;
  return {
    phase: "summarizing",
    participants: updatedParticipants,
    executionLog: [makeLog("waitForEntriesNode", "human", start, end, "等待双方提交歌曲（Human-in-the-loop）")],
  };
}

// ──────────────────────────────────────────────
// 总结节点（注入记忆上下文）
// ──────────────────────────────────────────────

async function fullGenerateSummaryNode(state: FullGameState): Promise<Partial<FullGameState>> {
  // 把记忆摘要注入到 roomName 后面，generateSummaryNode 的 prompt 会读取
  const enrichedInput = {
    roomName: state.memoryContextSummary
      ? `${state.roomName}（背景：${state.memoryContextSummary}）`
      : state.roomName,
    participants: state.participants,
    relationshipAnalysis: state.relationshipAnalysis,
    summary: undefined,
    tags: undefined,
    nextSongRecommendation: undefined,
    executionLog: [],
  };
  const result = await generateSummaryNode(
    enrichedInput as Parameters<typeof generateSummaryNode>[0]
  );
  return { ...result, phase: "done" };
}

// ──────────────────────────────────────────────
// updateMemoryNode：游戏结束后静默写入记忆
// ──────────────────────────────────────────────

async function updateMemoryNode(state: FullGameState): Promise<Partial<FullGameState>> {
  const start = new Date();

  // 异步写入，不等待（不阻塞用户看结果）
  writeMemoriesAsync(state).catch((e) =>
    console.error("[updateMemoryNode] 写入失败:", e)
  );

  return {
    executionLog: [makeLog("updateMemoryNode", "route", start, new Date(), "记忆更新中（后台异步）")],
  };
}

async function writeMemoriesAsync(state: FullGameState) {
  const [a, b] = state.participants;
  if (!a || !b) return;

  // 从 AI 分析结果里提取风格标签
  const stylesA = state.personalityProfiles?.[0]?.musicStyle
    ? [state.personalityProfiles[0].musicStyle]
    : [];
  const stylesB = state.personalityProfiles?.[1]?.musicStyle
    ? [state.personalityProfiles[1].musicStyle]
    : [];
  const keywords = state.extractedKeywords ?? [];

  const snapshot: GameSnapshot = {
    gameId: state.roomId || `game_${Date.now()}`,
    date: new Date().toISOString(),
    topicA: a.drawnTopic,
    topicB: b.drawnTopic,
    songA: { name: a.entry.songName, artist: a.entry.artist },
    songB: { name: b.entry.songName, artist: b.entry.artist },
    summaryExcerpt: state.summary?.slice(0, 50) ?? "",
  };

  const relationTags = state.relationshipAnalysis?.type
    ? [state.relationshipAnalysis.type, state.relationshipAnalysis.tone]
    : [];

  await Promise.all([
    state.userIdA
      ? upsertUserMemory(state.userIdA, state.nicknameA || a.nickname, { ...a.entry, topic: a.drawnTopic }, keywords, stylesA)
      : Promise.resolve(),
    state.userIdB
      ? upsertUserMemory(state.userIdB, state.nicknameB || b.nickname, { ...b.entry, topic: b.drawnTopic }, keywords, stylesB)
      : Promise.resolve(),
    (state.userIdA && state.userIdB)
      ? upsertPairMemory(state.userIdA, state.userIdB, snapshot, keywords, relationTags)
      : Promise.resolve(),
  ]);
}

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

function makeLog(
  node: string,
  type: ExecutionLogEntry["type"],
  start: Date,
  end: Date,
  summary: string
): ExecutionLogEntry {
  return {
    node,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    durationMs: end.getTime() - start.getTime(),
    type,
    summary,
  };
}

// ──────────────────────────────────────────────
// 图构建
// ──────────────────────────────────────────────

function buildFullGraph() {
  return new StateGraph(FullGameAnnotation)
    .addNode("loadMemoryNode", loadMemoryNode)
    .addNode("analyzeChatNode", fullAnalyzeChatNode)
    .addNode("generateTopicsNode", fullGenerateTopicsNode)
    .addNode("waitForDrawsNode", waitForDrawsNode)
    .addNode("waitForEntriesNode", waitForEntriesNode)
    .addNode("generateSummaryNode", fullGenerateSummaryNode)
    .addNode("updateMemoryNode", updateMemoryNode)
    .addEdge(START, "loadMemoryNode")
    .addEdge("loadMemoryNode", "analyzeChatNode")
    .addEdge("analyzeChatNode", "generateTopicsNode")
    .addEdge("generateTopicsNode", "waitForDrawsNode")
    .addEdge("waitForDrawsNode", "waitForEntriesNode")
    .addEdge("waitForEntriesNode", "generateSummaryNode")
    .addEdge("generateSummaryNode", "updateMemoryNode")
    .addEdge("updateMemoryNode", END);
}

export async function getCompiledGraph() {
  const checkpointer = await getCheckpointer();
  return buildFullGraph().compile({ checkpointer });
}

export function getCompiledGraphLocal() {
  return buildFullGraph().compile();
}
