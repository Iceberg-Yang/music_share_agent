import OpenAI from "openai";
import type { AnalysisAnnotation, SummaryAnnotation, ExecutionLogEntry } from "./state";
import { DEFAULT_TOPICS } from "@/lib/llm";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY || "placeholder",
  baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
});
const MODEL = process.env.LLM_MODEL || "deepseek-chat";

// ──────────────────────────────────────────────
// 工具：计时 + 构建日志
// ──────────────────────────────────────────────

function makeLogEntry(
  node: string,
  type: ExecutionLogEntry["type"],
  startAt: Date,
  endAt: Date,
  summary: string,
  thinking?: string
): ExecutionLogEntry {
  return {
    node,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    durationMs: endAt.getTime() - startAt.getTime(),
    type,
    summary,
    thinking,
  };
}

// ──────────────────────────────────────────────
// Node 1：analyzeChatNode（深度聊天分析）
// 仅在有 chatText 时运行
// ──────────────────────────────────────────────

export async function analyzeChatNode(
  state: typeof AnalysisAnnotation.State
): Promise<Partial<typeof AnalysisAnnotation.State>> {
  const startAt = new Date();

  if (!state.chatText || state.chatText.trim().length < 30) {
    return {
      extractedMood: "轻松自然",
      extractedKeywords: [],
      personalityProfiles: [],
      executionLog: [
        makeLogEntry(
          "analyzeChatNode",
          "route",
          startAt,
          new Date(),
          "聊天记录过短或为空，跳过深度分析"
        ),
      ],
    };
  }

  const hostCtx = state.hostConversationSummary
    ? `\n主持人对话中收集的背景：${state.hostConversationSummary}`
    : "";

  const prompt = `你是一个擅长从文字中读人的观察者。
请分析以下两人聊天记录，提取信息。

聊天记录（${state.chatText.length}字）：
${state.chatText.slice(0, 2000)}
${hostCtx}

请严格按照 JSON 格式返回（不要有任何额外文字）：
{
  "mood": "整体氛围，5字以内",
  "keywords": ["词1", "词2", "词3"],
  "relationship": {
    "type": "关系类型，例如：多年老友/暧昧期/新认识/情侣",
    "tone": "聊天语气，例如：轻松调侃/温柔细腻/久别重逢",
    "sharedMoments": ["片段1", "片段2"]
  },
  "personality_a": {
    "traits": ["标签1", "标签2", "标签3"],
    "musicStyle": "推测的音乐偏好，15字以内"
  },
  "personality_b": {
    "traits": ["标签1", "标签2"],
    "musicStyle": "推测的音乐偏好，15字以内"
  }
}

性格标签示例：安静内敛、爱怀旧、理性克制、情绪化、善用比喻、话少但精准
注意：不分析隐私信息，不做过度解读，保持客观。`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.6,
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const endAt = new Date();

    const profiles = [];
    if (parsed.personality_a?.traits?.length) {
      profiles.push({
        nickname: "",
        participantId: "",
        traits: parsed.personality_a.traits,
        musicStyle: parsed.personality_a.musicStyle || "",
      });
    }
    if (parsed.personality_b?.traits?.length) {
      profiles.push({
        nickname: "",
        participantId: "",
        traits: parsed.personality_b.traits,
        musicStyle: parsed.personality_b.musicStyle || "",
      });
    }

    const relationship = parsed.relationship
      ? {
          type: parsed.relationship.type || "朋友",
          tone: parsed.relationship.tone || "轻松",
          sharedMoments: Array.isArray(parsed.relationship.sharedMoments)
            ? parsed.relationship.sharedMoments.slice(0, 2)
            : [],
        }
      : undefined;

    const summary = `分析 ${state.chatText.length} 字聊天记录，提取到 ${profiles.length} 份性格档案，关系：${relationship?.type || "未知"}`;

    return {
      extractedMood: parsed.mood || "轻松自然",
      extractedKeywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      personalityProfiles: profiles,
      relationshipAnalysis: relationship,
      executionLog: [makeLogEntry("analyzeChatNode", "llm", startAt, endAt, summary, raw)],
    };
  } catch {
    const endAt = new Date();
    return {
      extractedMood: "轻松自然",
      extractedKeywords: [],
      personalityProfiles: [],
      executionLog: [
        makeLogEntry(
          "analyzeChatNode",
          "llm",
          startAt,
          endAt,
          "聊天分析失败，使用默认值"
        ),
      ],
    };
  }
}

// ──────────────────────────────────────────────
// Node 2：generateTopicsNode（基于分析结果生成主题）
// ──────────────────────────────────────────────

export async function generateTopicsNode(
  state: typeof AnalysisAnnotation.State
): Promise<Partial<typeof AnalysisAnnotation.State>> {
  const startAt = new Date();

  // 如果没有任何输入信息，直接返回默认主题
  const hasContext =
    state.extractedMood ||
    state.extractedKeywords.length > 0 ||
    state.moodHint ||
    state.hostConversationSummary;

  if (!hasContext) {
    const shuffled = [...DEFAULT_TOPICS].sort(() => Math.random() - 0.5);
    const topics = shuffled.slice(0, 16);
    return {
      topics,
      topicSource: "default",
      executionLog: [
        makeLogEntry(
          "generateTopicsNode",
          "route",
          startAt,
          new Date(),
          `无输入信息，使用默认主题池，共 ${topics.length} 个`
        ),
      ],
    };
  }

  // 构造 prompt 上下文
  const contextParts: string[] = [];
  if (state.extractedMood) contextParts.push(`整体氛围：${state.extractedMood}`);
  if (state.extractedKeywords.length > 0) contextParts.push(`关键词：${state.extractedKeywords.join("、")}`);
  if (state.moodHint) contextParts.push(`用户希望的氛围：${state.moodHint}`);
  if (state.hostConversationSummary) contextParts.push(`主持人对话信息：${state.hostConversationSummary}`);
  if (state.personalityProfiles.length > 0) {
    const styles = state.personalityProfiles.map((p) => p.musicStyle).filter(Boolean);
    if (styles.length > 0) contextParts.push(`两人音乐偏好：${styles.join(" / ")}`);
  }

  const prompt = `你是一个音乐抽签活动的主持人。请根据以下背景信息，生成适合双人音乐抽签活动的发散主题词。

背景信息：
${contextParts.join("\n")}

请严格按照 JSON 格式返回（不要有任何额外文字）：
{
  "topics": ["主题词1", "主题词2", ..., "主题词14"]
}

主题词要求：
- 每个主题词 2-5 个汉字
- 优先用名词、地点、颜色、天气、状态
- 风格上贴合背景信息中的氛围和偏好
- 不要过于具体，保留用户自己联想的空间
- 14个主题词各不相同`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.9,
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const endAt = new Date();

    const topics =
      Array.isArray(parsed.topics) && parsed.topics.length >= 8
        ? parsed.topics.slice(0, 16)
        : DEFAULT_TOPICS.sort(() => Math.random() - 0.5).slice(0, 16);

    return {
      topics,
      topicSource: "ai",
      executionLog: [
        makeLogEntry(
          "generateTopicsNode",
          "llm",
          startAt,
          endAt,
          `基于背景信息生成 ${topics.length} 个主题词`,
          raw
        ),
      ],
    };
  } catch {
    const shuffled = [...DEFAULT_TOPICS].sort(() => Math.random() - 0.5);
    const topics = shuffled.slice(0, 16);
    return {
      topics,
      topicSource: "default",
      executionLog: [
        makeLogEntry(
          "generateTopicsNode",
          "llm",
          startAt,
          new Date(),
          "主题生成失败，使用默认主题池"
        ),
      ],
    };
  }
}

// ──────────────────────────────────────────────
// Node 3：generateSummaryNode（总结 + 下一首推荐）
// ──────────────────────────────────────────────

export async function generateSummaryNode(
  state: typeof SummaryAnnotation.State
): Promise<Partial<typeof SummaryAnnotation.State>> {
  const startAt = new Date();

  if (state.participants.length < 2) {
    return {
      summary: "这场音乐局留下了两首各自的回响。",
      tags: [],
      executionLog: [
        makeLogEntry(
          "generateSummaryNode",
          "route",
          startAt,
          new Date(),
          "参与者不足，跳过生成"
        ),
      ],
    };
  }

  const [a, b] = state.participants;
  const rel = state.relationshipAnalysis;

  const aDesc = `${a.nickname}${a.traits.length ? `（${a.traits.join("、")}）` : ""}，抽到主题「${a.drawnTopic}」，分享了《${a.entry.songName}》- ${a.entry.artist}${a.entry.reason ? `，理由：${a.entry.reason}` : ""}`;
  const bDesc = `${b.nickname}${b.traits.length ? `（${b.traits.join("、")}）` : ""}，抽到主题「${b.drawnTopic}」，分享了《${b.entry.songName}》- ${b.entry.artist}${b.entry.reason ? `，理由：${b.entry.reason}` : ""}`;

  const relDesc = rel ? `\n两人关系：${rel.type}，${rel.tone}` : "";

  const prompt = `你是一个音乐局的旁观者，同时也是一个懂音乐的策展人。
根据以下信息写总结和推荐。

音乐局名称：${state.roomName}${relDesc}
${aDesc}
${bDesc}

请严格按照 JSON 格式返回（不要有任何额外文字）：
{
  "summary": "50-80字总结，第三人称旁观者视角，用意象不用评价",
  "tags": ["标签1", "标签2", "标签3"],
  "nextSongRecommendation": {
    "songName": "歌曲名",
    "artist": "歌手名",
    "reason": "30字以内，语气像朋友推荐"
  }
}

总结规范：
- 不得出现"默契""好听""非常"等套话
- 用场景感、画面感的意象，例如夜路、海边、窗帘、月台
- 保留一些模糊感，不过度解释
推荐规范：
- 推荐一首真实存在的歌曲
- 风格介于两人选择之间
- 理由要有温度，不要像算法推荐`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const endAt = new Date();

    const rec = parsed.nextSongRecommendation;

    return {
      summary: parsed.summary || "这场音乐局留下了两首各自的回响。",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      nextSongRecommendation:
        rec?.songName && rec?.artist
          ? { songName: rec.songName, artist: rec.artist, reason: rec.reason || "" }
          : undefined,
      executionLog: [
        makeLogEntry(
          "generateSummaryNode",
          "llm",
          startAt,
          endAt,
          `生成氛围总结${rec?.songName ? " + 推荐《" + rec.songName + "》" : ""}`,
          raw
        ),
      ],
    };
  } catch {
    return {
      summary: "这场音乐局留下了两首各自的回响。",
      tags: [],
      executionLog: [
        makeLogEntry(
          "generateSummaryNode",
          "llm",
          startAt,
          new Date(),
          "总结生成失败，使用默认文案"
        ),
      ],
    };
  }
}
