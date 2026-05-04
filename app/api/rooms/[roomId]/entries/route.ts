import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { ExecutionLogEntry } from "@/lib/agent/state";

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
      // 追加提交日志
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

      const room = await prisma.room.findUnique({ where: { id: roomId } });
      const existingLog: ExecutionLogEntry[] = room?.agentExecutionLog
        ? JSON.parse(room.agentExecutionLog)
        : [];

      // 只更新状态为 "submitted"，AI 总结由前端探测后调用 /summarize 触发
      await prisma.room.update({
        where: { id: roomId },
        data: {
          status: "submitted",
          agentPhase: "submitted",
          agentExecutionLog: JSON.stringify([...existingLog, ...submitLogs].slice(-20)),
        },
      });
    }

    return NextResponse.json({ entryId: entry.id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "提交音乐失败" }, { status: 500 });
  }
}
