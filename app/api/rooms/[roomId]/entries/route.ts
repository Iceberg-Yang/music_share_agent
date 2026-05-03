import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runSummaryGraph } from "@/lib/agent/graph";
import type { ExecutionLogEntry, PersonalityProfile, RelationshipAnalysis } from "@/lib/agent/state";

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
      // 两人都提交，启动 LangGraph 总结子图
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      if (!room) return NextResponse.json({ error: "房间不存在" }, { status: 404 });

      // 解析性格档案和关系分析
      const personalityProfiles: PersonalityProfile[] = room.agentPersonalityProfiles
        ? JSON.parse(room.agentPersonalityProfiles)
        : [];
      const relationshipAnalysis: RelationshipAnalysis | undefined = room.agentRelationship
        ? JSON.parse(room.agentRelationship)
        : undefined;

      // 构建总结图输入
      const summaryParticipants = allParticipants.map((p, idx) => {
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

      // 运行 LangGraph 总结子图
      const summaryResult = await runSummaryGraph({
        roomName: room.name,
        participants: summaryParticipants,
        relationshipAnalysis,
      });

      // 合并执行日志
      const existingLog: ExecutionLogEntry[] = room.agentExecutionLog
        ? JSON.parse(room.agentExecutionLog)
        : [];

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
          agentExecutionLog: JSON.stringify(newLog.slice(-20)), // 最多保留 20 条
        },
      });
    }

    return NextResponse.json({ entryId: entry.id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "提交音乐失败" }, { status: 500 });
  }
}
