import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 支持 inviteCode 或 roomId 查找
async function findRoom(roomId: string) {
  return await prisma.room.findFirst({
    where: { OR: [{ id: roomId }, { inviteCode: roomId }] },
    include: {
      participants: { orderBy: { joinedAt: "asc" } },
      entries: true,
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const room = await findRoom(roomId);

    if (!room) {
      return NextResponse.json({ error: "房间不存在" }, { status: 404 });
    }

    if (new Date() > room.expiresAt && room.status !== "completed") {
      await prisma.room.update({ where: { id: room.id }, data: { status: "expired" } });
      return NextResponse.json({ error: "房间已过期" }, { status: 410 });
    }

    return NextResponse.json({
      id: room.id,
      name: room.name,
      inviteCode: room.inviteCode,
      status: room.status,
      topicSource: room.topicSource,
      topics: JSON.parse(room.topics),
      aiSummary: room.aiSummary,
      aiTags: room.aiTags ? JSON.parse(room.aiTags) : [],
      participants: room.participants.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        drawnTopic: p.drawnTopic,
        hasEntry: room.entries.some((e) => e.participantId === p.id),
      })),
      entries: room.entries.map((e) => ({
        id: e.id,
        participantId: e.participantId,
        topic: e.topic,
        songName: e.songName,
        artist: e.artist,
        musicUrl: e.musicUrl,
        reason: e.reason,
      })),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "获取房间失败" }, { status: 500 });
  }
}
