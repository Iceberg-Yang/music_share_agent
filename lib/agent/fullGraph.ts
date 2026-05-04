/**
 * V3 完整 LangGraph
 *
 * 一张图覆盖整个双人音乐抽签的 Agent 生命周期：
 *
 *  analyzeChatNode → generateTopicsNode
 *        ↓
 *   [interrupt: 等待双方抽签]
 *        ↓
 *   [interrupt: 等待双方提交歌曲]
 *        ↓
 *   generateSummaryNode → END
 *
 * 真正的 Human-in-the-loop：
 * - interrupt() 使图在 Serverless 函数间暂停
 * - PostgresSaver 把每个 thread（roomId）的快照持久化到 Postgres
 * - resume（Command）携带用户操作后的数据触发图继续运行
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

// ──────────────────────────────────────────────
// 完整游戏状态 Annotation
// 合并了 V2 的 AnalysisAnnotation + SummaryAnnotation
// ──────────────────────────────────────────────

export const FullGameAnnotation = Annotation.Root({
  // ── 分析阶段输入 ──────────────────────────────
  chatText: Annotation<string | undefined>({
    value: (_p, n) => n,
    default: () => undefined,
  }),
  moodHint: Annotation<string | undefined>({
    value: (_p, n) => n,
    default: () => undefined,
  }),
  hostConversationSummary: Annotation<string>({
    value: (_p, n) => n,
    default: () => "",
  }),
  roomName: Annotation<string>({
    value: (_p, n) => n,
    default: () => "",
  }),

  // ── 分析阶段输出 ──────────────────────────────
  personalityProfiles: Annotation<PersonalityProfile[]>({
    value: (_p, n) => n,
    default: () => [],
  }),
  relationshipAnalysis: Annotation<RelationshipAnalysis | undefined>({
    value: (_p, n) => n,
    default: () => undefined,
  }),
  extractedMood: Annotation<string>({
    value: (_p, n) => n,
    default: () => "",
  }),
  extractedKeywords: Annotation<string[]>({
    value: (_p, n) => n,
    default: () => [],
  }),
  topics: Annotation<string[]>({
    value: (_p, n) => n,
    default: () => [],
  }),
  topicSource: Annotation<"default" | "ai">({
    value: (_p, n) => n,
    default: () => "default" as const,
  }),

  // ── Human-in-the-loop 数据（由 resume 注入）──
  participants: Annotation<ParticipantForSummary[]>({
    value: (_p, n) => n,
    default: () => [],
  }),

  // ── 总结阶段输出 ──────────────────────────────
  summary: Annotation<string | undefined>({
    value: (_p, n) => n,
    default: () => undefined,
  }),
  tags: Annotation<string[] | undefined>({
    value: (_p, n) => n,
    default: () => undefined,
  }),
  nextSongRecommendation: Annotation<NextSongRecommendation | undefined>({
    value: (_p, n) => n,
    default: () => undefined,
  }),

  // ── 执行日志（追加） ──────────────────────────
  executionLog: Annotation<ExecutionLogEntry[]>({
    value: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  // ── 阶段标志（供 API 路由读取当前进度）────────
  phase: Annotation<string>({
    value: (_p, n) => n,
    default: () => "init",
  }),
});

// ──────────────────────────────────────────────
// 分析适配器：把 FullGameAnnotation.State 适配给 analyzeChatNode / generateTopicsNode
// （这两个节点本来接受 AnalysisAnnotation.State）
// ──────────────────────────────────────────────

async function fullAnalyzeChatNode(
  state: typeof FullGameAnnotation.State
): Promise<Partial<typeof FullGameAnnotation.State>> {
  const result = await analyzeChatNode(state as Parameters<typeof analyzeChatNode>[0]);
  return { ...result, phase: "topics_generating" };
}

async function fullGenerateTopicsNode(
  state: typeof FullGameAnnotation.State
): Promise<Partial<typeof FullGameAnnotation.State>> {
  const result = await generateTopicsNode(state as Parameters<typeof generateTopicsNode>[0]);
  return { ...result, phase: "topics_ready" };
}

// ──────────────────────────────────────────────
// interrupt 节点 1：等待双方抽签完成
//
// 图在此暂停，Serverless 函数返回。
// 当 draw API 被调用，前端通过 Command.resume() 带入抽签数据继续执行。
// ──────────────────────────────────────────────

async function waitForDrawsNode(
  state: typeof FullGameAnnotation.State
): Promise<Partial<typeof FullGameAnnotation.State>> {
  const start = new Date();

  // interrupt() 调用后，当前执行暂停，等待 resume 注入数据
  // resume 时此处会返回前端通过 Command.resume({ participants }) 传入的值
  const resumed = interrupt({
    reason: "waiting_for_draws",
    topics: state.topics,
    personalityProfiles: state.personalityProfiles,
  });

  const end = new Date();
  return {
    phase: "drawing",
    participants: (resumed as { participants?: ParticipantForSummary[] }).participants ?? [],
    executionLog: [
      {
        node: "waitForDrawsNode",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        durationMs: end.getTime() - start.getTime(),
        type: "human",
        summary: "等待双方抽签（Human-in-the-loop interrupt）",
      },
    ],
  };
}

// ──────────────────────────────────────────────
// interrupt 节点 2：等待双方提交歌曲
// ──────────────────────────────────────────────

async function waitForEntriesNode(
  state: typeof FullGameAnnotation.State
): Promise<Partial<typeof FullGameAnnotation.State>> {
  const start = new Date();

  const resumed = interrupt({
    reason: "waiting_for_entries",
    participants: state.participants,
  });

  const end = new Date();

  // resume 时注入完整的参与者信息（含 entry）
  const updatedParticipants = (resumed as { participants?: ParticipantForSummary[] }).participants
    ?? state.participants;

  return {
    phase: "summarizing",
    participants: updatedParticipants,
    executionLog: [
      {
        node: "waitForEntriesNode",
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        durationMs: end.getTime() - start.getTime(),
        type: "human",
        summary: "等待双方提交歌曲（Human-in-the-loop interrupt）",
      },
    ],
  };
}

// ──────────────────────────────────────────────
// 总结适配器
// ──────────────────────────────────────────────

async function fullGenerateSummaryNode(
  state: typeof FullGameAnnotation.State
): Promise<Partial<typeof FullGameAnnotation.State>> {
  // SummaryAnnotation 子集
  const summaryInput = {
    roomName: state.roomName,
    participants: state.participants,
    relationshipAnalysis: state.relationshipAnalysis,
    summary: undefined,
    tags: undefined,
    nextSongRecommendation: undefined,
    executionLog: [],
  };
  const result = await generateSummaryNode(
    summaryInput as Parameters<typeof generateSummaryNode>[0]
  );
  return { ...result, phase: "done" };
}

// ──────────────────────────────────────────────
// 图构建
// ──────────────────────────────────────────────

function buildFullGraph() {
  const graph = new StateGraph(FullGameAnnotation)
    .addNode("analyzeChatNode", fullAnalyzeChatNode)
    .addNode("generateTopicsNode", fullGenerateTopicsNode)
    .addNode("waitForDrawsNode", waitForDrawsNode)
    .addNode("waitForEntriesNode", waitForEntriesNode)
    .addNode("generateSummaryNode", fullGenerateSummaryNode)
    .addEdge(START, "analyzeChatNode")
    .addEdge("analyzeChatNode", "generateTopicsNode")
    .addEdge("generateTopicsNode", "waitForDrawsNode")
    .addEdge("waitForDrawsNode", "waitForEntriesNode")
    .addEdge("waitForEntriesNode", "generateSummaryNode")
    .addEdge("generateSummaryNode", END);

  return graph;
}

// ──────────────────────────────────────────────
// 公开接口
// ──────────────────────────────────────────────

export type FullGameState = typeof FullGameAnnotation.State;

/**
 * 编译带 Checkpointer 的完整图（带持久化）
 */
export async function getCompiledGraph() {
  const checkpointer = await getCheckpointer();
  return buildFullGraph().compile({ checkpointer });
}

/**
 * 仅编译图（无持久化，用于本地测试）
 */
export function getCompiledGraphLocal() {
  return buildFullGraph().compile();
}
