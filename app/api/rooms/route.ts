import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEFAULT_TOPICS } from "@/lib/llm";
import { nanoid } from "@/lib/utils";
import { getCompiledGraph } from "@/lib/agent/fullGraph";
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

    // ── 先生成 inviteCode（用作 LangGraph thread_id）──────
    const inviteCode = nanoid(6);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let topics: string[] = [];
    let agentPhase = "topics_ready";
    let agentPersonalityProfiles: unknown[] = [];
    let agentRelationship: unknown = undefined;
    const agentExecutionLog: ExecutionLogEntry[] = [];

    // 从主持人对话历史中提取摘要
    let hostConversationSummary = "";
    if (Array.isArray(hostConversationHistory) && hostConversationHistory.length > 0) {
      hostConversationSummary = hostConversationHistory
        .map((m: { role: string; content: string }) =>
          `${m.role === "user" ? "用户" : "主持人"}：${m.content}`
        )
        .join("\n");

      // 记录主持人对话日志
      agentExecutionLog.unshift({
        node: "hostChatNode",
        startAt: new Date().toISOString(),
        endAt: new Date().toISOString(),
        durationMs: 0,
        type: "human",
        summary: `主持人对话 ${hostConversationHistory.length} 轮，收集到背景信息`,
      });
    }

    if (topicMode === "default") {
      const shuffled = [...DEFAULT_TOPICS].sort(() => Math.random() - 0.5);
      topics = shuffled.slice(0, 16);
    } else {
      // ── 运行完整 LangGraph（带 PostgreSQL Checkpointer）──
      // thread_id = inviteCode，确保 draw/entries 路由可以继续 resume 同一 thread
      const threadConfig = { configurable: { thread_id: inviteCode } };

      try {
        const graph = await getCompiledGraph();
        // invoke 会运行到 waitForDrawsNode 的 interrupt() 自动暂停
        // 暂停点的状态已通过 PostgresSaver 持久化到数据库
        const result = await graph.invoke(
          {
            chatText: topicMode === "ai_chat" ? (chatText?.trim() ?? undefined) : undefined,
            moodHint: moodHint?.trim() ?? undefined,
            hostConversationSummary,
            roomName: roomName.trim(),
            phase: "init",
          },
          threadConfig
        );

        topics = result.topics?.length >= 8
          ? result.topics
          : DEFAULT_TOPICS.sort(() => Math.random() - 0.5).slice(0, 16);

        agentPersonalityProfiles = result.personalityProfiles || [];
        agentRelationship = result.relationshipAnalysis ?? undefined;
        agentExecutionLog.push(...(result.executionLog || []));
        agentPhase = result.phase || "topics_ready";
      } catch (graphErr) {
        // 降级：graph 失败时仍用默认主题创建房间
        console.error("[FullGraph] invoke 失败，降级为默认主题:", graphErr);
        const shuffled = [...DEFAULT_TOPICS].sort(() => Math.random() - 0.5);
        topics = shuffled.slice(0, 16);
      }
    }

    // ── 创建房间记录 ──────────────────────────────────────
    // agentThreadId 字段存储 LangGraph thread_id（= inviteCode），供 resume 使用
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
