import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TOPICS } from "@/lib/llm";
import { nanoid } from "@/lib/utils";
import { runAnalysisGraph } from "@/lib/agent/graph";
import type { ExecutionLogEntry } from "@/lib/agent/state";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      roomName,
      nickname,
      topicMode,
      moodHint,
      chatText,
      hostConversationHistory,
    } = body;

    if (!roomName?.trim() || !nickname?.trim()) {
      return NextResponse.json({ error: "房间名和昵称不能为空" }, { status: 400 });
    }

    // ── 运行 LangGraph 分析子图 ──────────────────
    let topics: string[] = [];
    let agentPhase = "topics_ready";
    let agentPersonalityProfiles: unknown[] = [];
    let agentRelationship: unknown = undefined;
    const agentExecutionLog: ExecutionLogEntry[] = [];

    // 从主持人对话历史中提取摘要
    let hostConversationSummary = "";
    if (Array.isArray(hostConversationHistory) && hostConversationHistory.length > 0) {
      hostConversationSummary = hostConversationHistory
        .map((m: { role: string; content: string }) => `${m.role === "user" ? "用户" : "主持人"}：${m.content}`)
        .join("\n");
    }

    if (topicMode === "default") {
      const shuffled = [...DEFAULT_TOPICS].sort(() => Math.random() - 0.5);
      topics = shuffled.slice(0, 16);
    } else {
      // 使用 LangGraph 分析子图生成主题
      const analysisResult = await runAnalysisGraph({
        chatText: topicMode === "ai_chat" ? chatText?.trim() : undefined,
        moodHint: moodHint?.trim() || undefined,
        hostConversationSummary: hostConversationSummary || undefined,
      });

      topics = analysisResult.topics?.length >= 8
        ? analysisResult.topics
        : DEFAULT_TOPICS.sort(() => Math.random() - 0.5).slice(0, 16);

      agentPersonalityProfiles = analysisResult.personalityProfiles || [];
      agentRelationship = analysisResult.relationshipAnalysis;
      agentExecutionLog.push(...(analysisResult.executionLog || []));

      // 加入主持人对话日志
      if (Array.isArray(hostConversationHistory) && hostConversationHistory.length > 0) {
        agentExecutionLog.unshift({
          node: "hostChatNode",
          startAt: new Date().toISOString(),
          endAt: new Date().toISOString(),
          durationMs: 0,
          type: "human",
          summary: `主持人对话 ${hostConversationHistory.length} 轮，收集到背景信息`,
        });
      }
    }

    // ── 创建房间记录 ──────────────────────────────
    const inviteCode = nanoid(6);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const room = await prisma.room.create({
      data: {
        name: roomName.trim(),
        inviteCode,
        topicSource: topicMode === "default" ? "default" : "ai",
        topics: JSON.stringify(topics),
        expiresAt,
        agentPhase,
        agentPersonalityProfiles:
          agentPersonalityProfiles.length > 0
            ? JSON.stringify(agentPersonalityProfiles)
            : null,
        agentRelationship: agentRelationship
          ? JSON.stringify(agentRelationship)
          : null,
        agentExecutionLog:
          agentExecutionLog.length > 0
            ? JSON.stringify(agentExecutionLog)
            : null,
        participants: {
          create: { nickname: nickname.trim() },
        },
      },
      include: { participants: true },
    });

    const participant = room.participants[0];

    return NextResponse.json({
      roomId: room.id,
      inviteCode: room.inviteCode,
      participantId: participant.id,
      sessionToken: participant.sessionToken,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "创建房间失败" }, { status: 500 });
  }
}
