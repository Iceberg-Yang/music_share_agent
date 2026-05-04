import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Command } from "@langchain/langgraph";
import { getCompiledGraph } from "@/lib/agent/fullGraph";
import type { ExecutionLogEntry, PersonalityProfile, ParticipantForSummary, NextSongRecommendation } from "@/lib/agent/state";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const { participantId, sessionToken, songName, artist, musicUrl, reason } = await req.json();

    const participant = await prisma.participant.findFirst({
      where: { id: participantId, sessionToken, roomId },
    });
    if (!participant) return NextResponse.json({ error: "身份验证失败" }, { status: 401 });
    if (!participant.drawnTopic) return NextResponse.json({ error: "还没有抽签" }, { status: 400 });
    if (!songName?.trim()) return NextResponse.json({ error: "歌名不能为空" }, { status: 400 });
    if (!artist?.trim()) return NextResponse.json({ error: "歌手不能为空" }, { status: 400 });

    const existing = await prisma.musicEntry.findUnique({ where: { participantId } });

    let entry;
    if (existing) {
      entry = await prisma.musicEntry.update({
        where: { participantId },
        data: {
          songName: songName.trim(),
          artist: artist.trim(),
          musicUrl: musicUrl?.trim() || null,
          reason: reason?.trim() || null,
        },
      });
    } else {
      entry = await prisma.musicEntry.create({
        data: {
          roomId,
          participantId,
          topic: participant.drawnTopic,
          songName: songName.trim(),
          artist: artist.trim(),
          musicUrl: musicUrl?.trim() || null,
          reason: reason?.trim() || null,
        },
      });
    }

    // 检查是否两人都提交了
    const allEntries = await prisma.musicEntry.findMany({ where: { roomId } });
    const allParticipants = await prisma.participant.findMany({ where: { roomId } });

    if (allEntries.length >= 2 && allParticipants.length === 2) {
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return NextResponse.json({ error: "房间不存在" }, { status: 404 });

      const personalityProfiles: PersonalityProfile[] = room.agentPersonalityProfiles
        ? JSON.parse(room.agentPersonalityProfiles)
        : [];

      // 构建完整参与者数据（含歌曲 entry）
      const participantsForGraph: ParticipantForSummary[] = allParticipants.map((p, idx) => {
        const e = allEntries.find((en) => en.participantId === p.id);
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

      // 提交日志
      const submitLogs: ExecutionLogEntry[] = allParticipants.map((p) => {
        const e = allEntries.find((en) => en.participantId === p.id);
        return {
          node: "waitForEntriesNode",
          startAt: new Date().toISOString(),
          endAt: new Date().toISOString(),
          durationMs: 0,
          type: "human" as const,
          summary: `${p.nickname} 提交了《${e?.songName}》- ${e?.artist}`,
        };
      });

      // ── 真正的 Human-in-the-loop：resume 到 generateSummaryNode ──
      // thread_id = inviteCode，与创建时保持一致
      let summaryResult: {
        summary?: string;
        tags?: string[];
        nextSongRecommendation?: NextSongRecommendation;
        executionLog?: ExecutionLogEntry[];
      } = {};

      try {
        const graph = await getCompiledGraph();
        // resume 图：传入完整参与者数据（含歌曲），图继续运行到 generateSummaryNode → END
        summaryResult = await graph.invoke(
          new Command({ resume: { participants: participantsForGraph } }),
          { configurable: { thread_id: room.inviteCode } }
        );
      } catch (graphErr) {
        console.error("[FullGraph] entries resume 失败:", graphErr);
        // 降级：直接用 V2 方式调用总结（保留业务连续性）
        const { runSummaryGraph } = await import("@/lib/agent/graph");
        const fallbackResult = await runSummaryGraph({
          roomName: room.name,
          participants: participantsForGraph,
          relationshipAnalysis: room.agentRelationship
            ? JSON.parse(room.agentRelationship)
            : undefined,
        });
        summaryResult = fallbackResult;
      }

      // 合并执行日志
      const existingLog: ExecutionLogEntry[] = room.agentExecutionLog
        ? JSON.parse(room.agentExecutionLog)
        : [];

      const newLog: ExecutionLogEntry[] = [
        ...existingLog,
        ...submitLogs,
        ...(summaryResult.executionLog || []),
      ];

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
          agentExecutionLog: JSON.stringify(newLog.slice(-20)),
        },
      });
    }

    return NextResponse.json({ entryId: entry.id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "提交音乐失败" }, { status: 500 });
  }
}
