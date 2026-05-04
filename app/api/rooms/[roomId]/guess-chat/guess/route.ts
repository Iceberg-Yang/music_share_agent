import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PYTHON_SERVICE = process.env.MUSIC_TOOL_SERVER_URL ?? "http://localhost:8001";

/**
 * POST /api/rooms/:roomId/guess-chat/guess
 * Body: { participantId: string, sessionToken: string, guess: string }
 *
 * resume GuessChatGraph，注入用户猜测词，返回 AI 裁判结果 + 提示
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const { participantId, sessionToken, guess } = await req.json();

    if (!guess?.trim()) {
      return NextResponse.json({ error: "猜测内容不能为空" }, { status: 400 });
    }

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

    const resp = await fetch(`${PYTHON_SERVICE}/guess-chat/guess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thread_id, guess: guess.trim() }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return NextResponse.json({ error: `Python 服务错误: ${err}` }, { status: 502 });
    }

    const data = await resp.json();

    // 猜对时，将结果持久化到数据库
    if (data.resolved || data.verdict === "correct") {
      await prisma.participant.update({
        where: { id: participantId },
        data: {
          guess: guess.trim(),
          guessCorrect: data.verdict === "correct",
        },
      });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("[guess-chat/guess]", e);
    return NextResponse.json({ error: "提交猜测失败" }, { status: 500 });
  }
}
