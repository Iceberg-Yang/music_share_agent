import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const { nickname } = await req.json();

    if (!nickname?.trim()) {
      return NextResponse.json({ error: "昵称不能为空" }, { status: 400 });
    }

    const room = await prisma.room.findFirst({
      where: { OR: [{ id: roomId }, { inviteCode: roomId }] },
      include: { participants: true },
    });

    if (!room) return NextResponse.json({ error: "房间不存在" }, { status: 404 });
    if (new Date() > room.expiresAt) return NextResponse.json({ error: "房间已过期" }, { status: 410 });
    if (room.participants.length >= 2) return NextResponse.json({ error: "房间已满" }, { status: 409 });

    const nameTaken = room.participants.some(
      (p) => p.nickname.toLowerCase() === nickname.trim().toLowerCase()
    );
    if (nameTaken) return NextResponse.json({ error: "昵称已被使用" }, { status: 409 });

    const participant = await prisma.participant.create({
      data: { roomId: room.id, nickname: nickname.trim() },
    });

    await prisma.room.update({
      where: { id: room.id },
      data: { status: "ready" },
    });

    return NextResponse.json({
      participantId: participant.id,
      sessionToken: participant.sessionToken,
      roomId: room.id,
      roomName: room.name,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "加入房间失败" }, { status: 500 });
  }
}
