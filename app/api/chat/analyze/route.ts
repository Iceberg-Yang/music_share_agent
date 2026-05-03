import { NextRequest, NextResponse } from "next/server";
import { analyzeChatAndGenerateTopics } from "@/lib/llm";

export async function POST(req: NextRequest) {
  try {
    const { content, moodHint, participants } = await req.json();
    if (!content?.trim()) return NextResponse.json({ error: "聊天记录不能为空" }, { status: 400 });

    const result = await analyzeChatAndGenerateTopics(
      content.trim(),
      moodHint?.trim() || ""
    );

    return NextResponse.json({
      ...result,
      participants: participants || [],
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "分析聊天记录失败" }, { status: 500 });
  }
}
