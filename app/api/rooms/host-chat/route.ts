import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY || "placeholder",
  baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
});
const MODEL = process.env.LLM_MODEL || "deepseek-v4-flash";

const SYSTEM_PROMPT = `你是一个音乐抽签活动的 AI 主持人，性格温和、有点文艺，说话简洁不罗嗦。
你需要通过最多 3 轮对话了解用户这次音乐分享的背景，包括：
1. 和谁分享（朋友/恋人/同学等关系）
2. 什么场合或情境（开车/晚上聊天/旅行等）
3. 最近的状态或心情（可选）

规则：
- 每次只问一个问题，不要堆砌多个问题
- 语气自然，像朋友聊天，不要像表单填写
- 回复控制在 2-3 句话
- 当你觉得收集到足够信息时（通常 2-3 轮后），或者用户明确说"开始"/"好了"/"差不多了"，在回复末尾加上特殊标记 [DONE]
- 不要主动提 [DONE]，它只是你判断信息充分时的内部信号
- 第一轮主动打招呼并提问`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      message,
      conversationHistory,
    }: {
      message: string;
      conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
    } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: "消息不能为空" }, { status: 400 });
    }

    // 拼接完整对话历史
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...conversationHistory.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: message },
    ];

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 200,
    });

    const reply = response.choices[0]?.message?.content || "嗨！这次想分享什么样的音乐？";
    const isDone =
      reply.includes("[DONE]") ||
      conversationHistory.length >= 6 || // 3 轮对话后强制结束
      /开始吧|好了|差不多了|知道了/.test(message);

    // 清理 [DONE] 标记
    const cleanReply = reply.replace("[DONE]", "").trim();

    // 如果对话结束，提取信息摘要
    let extractedInfo: { moodHint: string; keywords: string[] } | undefined;
    if (isDone) {
      extractedInfo = await extractInfoFromConversation([
        ...conversationHistory,
        { role: "user", content: message },
        { role: "assistant", content: cleanReply },
      ]);
    }

    return NextResponse.json({
      reply: cleanReply,
      isDone,
      extractedInfo,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "主持人暂时不在，请直接开始吧" }, { status: 500 });
  }
}

// 从对话历史中提取氛围摘要（供主题生成使用）
async function extractInfoFromConversation(
  history: Array<{ role: string; content: string }>
): Promise<{ moodHint: string; keywords: string[] }> {
  const dialogText = history
    .map((m) => `${m.role === "user" ? "用户" : "主持人"}：${m.content}`)
    .join("\n");

  const prompt = `根据以下对话，提取关键信息用于生成音乐主题。

对话内容：
${dialogText}

请严格按照 JSON 格式返回（不要有额外文字）：
{
  "moodHint": "15字以内，描述整体氛围或场景，例如：晚上开车，南方公路感",
  "keywords": ["关键词1", "关键词2", "关键词3"]
}`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.5,
    });
    const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
    return {
      moodHint: parsed.moodHint || "",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch {
    return { moodHint: "", keywords: [] };
  }
}
