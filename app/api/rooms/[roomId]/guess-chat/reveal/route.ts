import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PYTHON_SERVICE = process.env.MUSIC_TOOL_SERVER_URL ?? "http://localhost:8001";

/**
 * POST /api/rooms/:roomId/guess-chat/reveal
 * Body: { participantId: string, sessionToken: string }
 *
 * 玩家放弃猜测，强制揭晓答案
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const { participantId, sessionToken } = await req.json();

    const participant = await prisma.participant.findFirst({
      where: { id: participantId, sessionToken },
    });
    if (!participant) {
      return NextResponse.json({ error: "身份验证失败" }, { status: 401 });
    }

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      return NextResponse.json({ error: "房间不存在" }, { status: 404 });
    }

    const thread_id = `${room.inviteCode}_guess_${participantId}`;

    const resp = await fetch(`${PYTHON_SERVICE}/guess-chat/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return NextResponse.json({ error: `Python 服务错误: ${err}` }, { status: 502 });
    }

    const data = await resp.json();

    // 揭晓后保存失败状态
    await prisma.participant.update({
      where: { id: participantId },
      data: {
        guessCorrect: false,
      },
    });

    return NextResponse.json(data);
  } catch (e) {
    console.error("[guess-chat/reveal]", e);
    return NextResponse.json({ error: "揭晓失败" }, { status: 500 });
  }
}
