import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/rooms/:roomId/guess
 * Body: { participantId: string, guess: string, sessionToken: string }
 *
 * 玩家提交对对方主题的猜测，系统自动判断是否正确。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const { participantId, guess, sessionToken } = await req.json();

    if (!guess?.trim()) {
      return NextResponse.json({ error: "猜测内容不能为空" }, { status: 400 });
    }

    // 验证 session
    const participant = await prisma.participant.findFirst({
      where: { id: participantId, sessionToken },
    });
    if (!participant) {
      return NextResponse.json({ error: "身份验证失败" }, { status: 401 });
    }

    // 找到房间和双方参与者
    const room = await prisma.room.findUnique({
      where: { id: participant.roomId },
      include: { participants: true },
    });
    if (!room || room.status !== "completed") {
      return NextResponse.json({ error: "房间未完成，无法猜测" }, { status: 400 });
    }

    // 找到对方
    const opponent = room.participants.find((p) => p.id !== participantId);
    if (!opponent) {
      return NextResponse.json({ error: "对方参与者未找到" }, { status: 400 });
    }

    // 判断是否猜对（忽略大小写和空格，模糊匹配）
    const normalizedGuess = guess.trim().toLowerCase().replace(/\s/g, "");
    const normalizedAnswer = (opponent.drawnTopic ?? "").toLowerCase().replace(/\s/g, "");
    const guessCorrect = normalizedAnswer.length > 0 && (
      normalizedAnswer.includes(normalizedGuess) ||
      normalizedGuess.includes(normalizedAnswer)
    );

    // 保存猜测
    await prisma.participant.update({
      where: { id: participantId },
      data: { guess: guess.trim(), guessCorrect },
    });

    return NextResponse.json({
      guessCorrect,
      answer: opponent.drawnTopic,
    });
  } catch (e) {
    console.error("[guess] 失败:", e);
    return NextResponse.json({ error: "提交失败" }, { status: 500 });
  }
}
