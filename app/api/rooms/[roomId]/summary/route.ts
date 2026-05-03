import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateSummary } from "@/lib/llm";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        participants: true,
        entries: true,
      },
    });

    if (!room) return NextResponse.json({ error: "房间不存在" }, { status: 404 });
    if (room.entries.length < 2) return NextResponse.json({ error: "还有人未提交音乐" }, { status: 400 });

    const entriesWithNickname = room.entries.map((e) => {
      const p = room.participants.find((p) => p.id === e.participantId);
      return {
        nickname: p?.nickname || "未知",
        topic: e.topic,
        songName: e.songName,
        artist: e.artist,
        reason: e.reason || undefined,
      };
    });

    const result = await generateSummary(room.name, entriesWithNickname);

    await prisma.room.update({
      where: { id: roomId },
      data: {
        aiSummary: result.summary,
        aiTags: JSON.stringify(result.tags),
        status: "completed",
      },
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "生成总结失败" }, { status: 500 });
  }
}
