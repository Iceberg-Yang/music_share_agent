import { StateGraph, START, END } from "@langchain/langgraph";
import { AnalysisAnnotation, SummaryAnnotation } from "./state";
import { analyzeChatNode, generateTopicsNode, generateSummaryNode } from "./nodes";
import type { RelationshipAnalysis, ParticipantForSummary } from "./state";

// ──────────────────────────────────────────────
// 子图 A：分析图（创建房间时调用）
// 流程：START → analyzeChatNode → generateTopicsNode → END
// ──────────────────────────────────────────────

export function buildAnalysisGraph() {
  const graph = new StateGraph(AnalysisAnnotation)
    .addNode("analyzeChatNode", analyzeChatNode)
    .addNode("generateTopicsNode", generateTopicsNode)
    .addEdge(START, "analyzeChatNode")
    .addEdge("analyzeChatNode", "generateTopicsNode")
    .addEdge("generateTopicsNode", END);

  return graph.compile();
}

// ──────────────────────────────────────────────
// 子图 B：总结图（两人都提交音乐后调用）
// 流程：START → generateSummaryNode → END
// ──────────────────────────────────────────────

export function buildSummaryGraph() {
  const graph = new StateGraph(SummaryAnnotation)
    .addNode("generateSummaryNode", generateSummaryNode)
    .addEdge(START, "generateSummaryNode")
    .addEdge("generateSummaryNode", END);

  return graph.compile();
}

// ──────────────────────────────────────────────
// 运行分析图（供 API 调用）
// ──────────────────────────────────────────────

export async function runAnalysisGraph(input: {
  chatText?: string;
  moodHint?: string;
  hostConversationSummary?: string;
}) {
  const graph = buildAnalysisGraph();
  const result = await graph.invoke({
    chatText: input.chatText ?? undefined,
    moodHint: input.moodHint ?? undefined,
    hostConversationSummary: input.hostConversationSummary ?? "",
  });
  return result;
}

// ──────────────────────────────────────────────
// 运行总结图（供 API 调用）
// ──────────────────────────────────────────────

export async function runSummaryGraph(input: {
  roomName: string;
  participants: ParticipantForSummary[];
  relationshipAnalysis?: RelationshipAnalysis;
}) {
  const graph = buildSummaryGraph();
  const result = await graph.invoke({
    roomName: input.roomName,
    participants: input.participants,
    relationshipAnalysis: input.relationshipAnalysis ?? undefined,
  });
  return result;
}
