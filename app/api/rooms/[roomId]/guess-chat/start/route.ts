import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PYTHON_SERVICE = process.env.MUSIC_TOOL_SERVER_URL ?? "http://localhost:8001";

/**
 * POST /api/rooms/:roomId/guess-chat/start
 * Body: { participantId: string, sessionToken: string }
 *
 * 验证身份 → 从 DB 取对方歌曲/主题 → 转发到 Python GuessChatGraph
 * 返回第一条 AI 线索
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

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        participants: {
          include: { entry: true },
        },
      },
    });
    if (!room || room.status !== "completed") {
      return NextResponse.json({ error: "游戏尚未结束，无法开始猜谜" }, { status: 400 });
    }

    const opponent = room.participants.find((p) => p.id !== participantId);
    if (!opponent?.drawnTopic || !opponent?.entry?.songName) {
      return NextResponse.json({ error: "对方信息不完整" }, { status: 400 });
    }

    const thread_id = `${room.inviteCode}_guess_${participantId}`;

    const resp = await fetch(`${PYTHON_SERVICE}/guess-chat/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thread_id,
        song_name: opponent.entry.songName,
        artist: opponent.entry.artist ?? "",
        topic: opponent.drawnTopic,
        max_attempts: 3,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return NextResponse.json({ error: `Python 服务错误: ${err}` }, { status: 502 });
    }

    return NextResponse.json(await resp.json());
  } catch (e) {
    console.error("[guess-chat/start]", e);
    return NextResponse.json({ error: "启动猜谜失败" }, { status: 500 });
  }
}
