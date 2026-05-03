import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateTopicsFromMood, analyzeChatAndGenerateTopics, DEFAULT_TOPICS } from "@/lib/llm";
import { nanoid } from "@/lib/utils";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { roomName, nickname, topicMode, moodHint, chatText } = body;

    if (!roomName?.trim() || !nickname?.trim()) {
      return NextResponse.json({ error: "房间名和昵称不能为空" }, { status: 400 });
    }

    let topics: string[] = [];

    if (topicMode === "ai_mood" && moodHint?.trim()) {
      topics = await generateTopicsFromMood(moodHint.trim());
    } else if (topicMode === "ai_chat" && chatText?.trim()) {
      const result = await analyzeChatAndGenerateTopics(chatText.trim(), moodHint?.trim());
      topics = result.topics;
    } else {
      const shuffled = [...DEFAULT_TOPICS].sort(() => Math.random() - 0.5);
      topics = shuffled.slice(0, 16);
    }

    const inviteCode = nanoid(6);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const room = await prisma.room.create({
      data: {
        name: roomName.trim(),
        inviteCode,
        topicSource: topicMode === "default" ? "default" : "ai",
        topics: JSON.stringify(topics),
        expiresAt,
        participants: {
          create: {
            nickname: nickname.trim(),
          },
        },
      },
      include: { participants: true },
    });

    const participant = room.participants[0];

    return NextResponse.json({
      roomId: room.id,
      inviteCode: room.inviteCode,
      participantId: participant.id,
      sessionToken: participant.sessionToken,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "创建房间失败" }, { status: 500 });
  }
}
