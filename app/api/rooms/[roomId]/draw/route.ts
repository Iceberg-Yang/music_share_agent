import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runSummaryGraph } from "@/lib/agent/graph";
import type { ExecutionLogEntry } from "@/lib/agent/state";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const { participantId, sessionToken } = await req.json();

    const participant = await prisma.participant.findFirst({
      where: { id: participantId, sessionToken, roomId },
    });
    if (!participant) return NextResponse.json({ error: "身份验证失败" }, { status: 401 });
    if (participant.drawnTopic) return NextResponse.json({ error: "已经抽过签了" }, { status: 409 });

    const room = await prisma.room.findUnique({
      where: { id: roomId },
      include: { participants: true },
    });
    if (!room) return NextResponse.json({ error: "房间不存在" }, { status: 404 });
    if (room.participants.length < 2) return NextResponse.json({ error: "等待另一人加入" }, { status: 400 });

    const allTopics: string[] = JSON.parse(room.topics);
    const takenTopics = room.participants
      .map((p: { drawnTopic: string | null }) => p.drawnTopic)
      .filter(Boolean) as string[];
    const available = allTopics.filter((t) => !takenTopics.includes(t));

    if (available.length === 0) {
      return NextResponse.json({ error: "主题已用完" }, { status: 400 });
    }

    const drawnTopic = available[Math.floor(Math.random() * available.length)];

    const updated = await prisma.$transaction(async (tx: Tx) => {
      const freshParticipants = await tx.participant.findMany({ where: { roomId } });
      const freshTaken = freshParticipants
        .map((p: { drawnTopic: string | null }) => p.drawnTopic)
        .filter(Boolean) as string[];
      const freshAvailable = allTopics.filter((t) => !freshTaken.includes(t));

      if (!freshAvailable.includes(drawnTopic)) {
        const fallback = freshAvailable[Math.floor(Math.random() * freshAvailable.length)];
        if (!fallback) throw new Error("no_topics");
        return await tx.participant.update({
          where: { id: participantId },
          data: { drawnTopic: fallback },
        });
      }

      return await tx.participant.update({
        where: { id: participantId },
        data: { drawnTopic },
      });
    });

    // 检查是否两人都抽签了，更新 agentPhase
    const allParticipants = await prisma.participant.findMany({ where: { roomId } });
    const allDrawn = allParticipants.every((p) => p.drawnTopic);

    if (allDrawn) {
      // 追加 human 日志
      const existingLog: ExecutionLogEntry[] = room.agentExecutionLog
        ? JSON.parse(room.agentExecutionLog)
        : [];

      const drawLog: ExecutionLogEntry[] = allParticipants.map((p) => ({
        node: "waitForDrawNode",
        startAt: new Date().toISOString(),
        endAt: new Date().toISOString(),
        durationMs: 0,
        type: "human" as const,
        summary: `${p.nickname} 抽到主题「${p.drawnTopic}」`,
      }));

      await prisma.room.update({
        where: { id: roomId },
        data: {
          status: "drawing",
          agentPhase: "collecting",
          agentExecutionLog: JSON.stringify([...existingLog, ...drawLog]),
        },
      });
    }

    return NextResponse.json({ topic: updated.drawnTopic });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "";
    if (msg === "no_topics") return NextResponse.json({ error: "主题已用完，请重试" }, { status: 409 });
    return NextResponse.json({ error: "抽签失败" }, { status: 500 });
  }
}
