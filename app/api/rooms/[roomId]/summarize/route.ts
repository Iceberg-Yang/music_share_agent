import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Command } from "@langchain/langgraph";
import { getCompiledGraph } from "@/lib/agent/fullGraph";
import type {
  ExecutionLogEntry,
  PersonalityProfile,
  ParticipantForSummary,
  NextSongRecommendation,
} from "@/lib/agent/state";

// Vercel 最大函数执行时间（Pro 最大 60s，Hobby 最大 60s via Fluid）
export const maxDuration = 60;

/**
 * POST /api/rooms/:roomId/summarize
 *
 * 双方都提交歌曲后，由前端主动调用此接口触发 AI 总结。
 * 与 entries/route.ts 解耦，避免长时间占用 entries 函数。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { participants: true, entries: true },
    });

    if (!room) return NextResponse.json({ error: "房间不存在" }, { status: 404 });

    // 防止重复执行
    if (room.status === "completed") {
      return NextResponse.json({ already: true });
    }
    if (room.agentPhase === "summarizing_in_progress") {
      return NextResponse.json({ inProgress: true });
    }

    if (room.entries.length < 2 || room.participants.length < 2) {
      return NextResponse.json({ error: "参与者或歌曲未齐全" }, { status: 400 });
    }

    // 标记进行中，防止并发重复触发
    await prisma.room.update({
      where: { id: roomId },
      data: { agentPhase: "summarizing_in_progress" },
    });

    const personalityProfiles: PersonalityProfile[] = room.agentPersonalityProfiles
      ? JSON.parse(room.agentPersonalityProfiles)
      : [];

    const participantsForGraph: ParticipantForSummary[] = room.participants.map((p, idx) => {
      const e = room.entries.find((en) => en.participantId === p.id);
      const profile = personalityProfiles[idx];
      return {
        id: p.id,
        nickname: p.nickname,
        drawnTopic: p.drawnTopic || "",
        traits: profile?.traits || [],
        musicStyle: profile?.musicStyle || "",
        entry: {
          songName: e?.songName || "",
          artist: e?.artist || "",
          reason: e?.reason || undefined,
        },
      };
    });

    let summaryResult: {
      summary?: string;
      tags?: string[];
      nextSongRecommendation?: NextSongRecommendation;
      executionLog?: ExecutionLogEntry[];
    } = {};

    try {
      const graph = await getCompiledGraph();
      summaryResult = await graph.invoke(
        new Command({ resume: { participants: participantsForGraph } }),
        { configurable: { thread_id: room.inviteCode } }
      );
    } catch (graphErr) {
      console.error("[summarize] FullGraph resume 失败，降级到 V2:", graphErr);
      try {
        const { runSummaryGraph } = await import("@/lib/agent/graph");
        const fallback = await runSummaryGraph({
          roomName: room.name,
          participants: participantsForGraph,
          relationshipAnalysis: room.agentRelationship
            ? JSON.parse(room.agentRelationship)
            : undefined,
        });
        summaryResult = fallback;
      } catch (fallbackErr) {
        console.error("[summarize] V2 降级也失败:", fallbackErr);
        summaryResult = {
          summary: "这场音乐局留下了两首很有意思的歌，期待下次再听。",
          tags: [],
        };
      }
    }

    const existingLog: ExecutionLogEntry[] = room.agentExecutionLog
      ? JSON.parse(room.agentExecutionLog)
      : [];

    await prisma.room.update({
      where: { id: roomId },
      data: {
        status: "completed",
        agentPhase: "done",
        aiSummary: summaryResult.summary,
        aiTags: summaryResult.tags ? JSON.stringify(summaryResult.tags) : null,
        agentNextSong: summaryResult.nextSongRecommendation
          ? JSON.stringify(summaryResult.nextSongRecommendation)
          : null,
        agentExecutionLog: JSON.stringify(
          [...existingLog, ...(summaryResult.executionLog || [])].slice(-20)
        ),
      },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[summarize] 失败:", e);
    // 重置进行中标记，允许重试
    const { roomId } = await params;
    await prisma.room.update({
      where: { id: roomId },
      data: { agentPhase: "done" },
    }).catch(() => {});
    return NextResponse.json({ error: "总结失败" }, { status: 500 });
  }
}
