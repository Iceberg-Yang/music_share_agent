import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nanoid } from "@/lib/utils";

/**
 * POST /api/rooms/:roomId/reaction
 * Body: { participantId, sessionToken, accuracyVote?, comment? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const { participantId, sessionToken, accuracyVote, comment } = await req.json();

    // 验证 session
    const participant = await prisma.participant.findFirst({
      where: { id: participantId, sessionToken },
    });
    if (!participant || participant.roomId !== roomId) {
      return NextResponse.json({ error: "身份验证失败" }, { status: 401 });
    }

    // 去重：每人只能留言一次
    const exists = await prisma.gameReaction.findFirst({
      where: { roomId, participantId },
    });
    if (exists) {
      return NextResponse.json({ message: "已经留言过了" });
    }

    await prisma.gameReaction.create({
      data: {
        id: nanoid(),
        roomId,
        participantId,
        accuracyVote: accuracyVote ?? null,
        comment: comment?.slice(0, 100) ?? null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[reaction] 失败:", e);
    return NextResponse.json({ error: "提交失败" }, { status: 500 });
  }
}

/** GET /api/rooms/:roomId/reaction 查询当前房间所有反应 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const reactions = await prisma.gameReaction.findMany({
      where: { roomId },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ reactions });
  } catch {
    return NextResponse.json({ reactions: [] });
  }
}
