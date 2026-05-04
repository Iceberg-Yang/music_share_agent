import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.LLM_API_KEY || "placeholder",
  baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
});

const MODEL = process.env.LLM_MODEL || "deepseek-v4-flash";

export interface ChatAnalysisResult {
  mood: string;
  keywords: string[];
  relationshipTone: string;
  topics: string[];
}

export interface SummaryResult {
  summary: string;
  tags: string[];
}

// 分析聊天记录并一次性生成主题（合并调用）
export async function analyzeChatAndGenerateTopics(
  chatText: string,
  moodHint: string = ""
): Promise<ChatAnalysisResult> {
  const prompt = `你是一个音乐抽签活动的主持人。请分析以下聊天记录，提取氛围和关键词，并生成适合双人音乐抽签活动的发散主题词。

聊天记录：
${chatText}

${moodHint ? `用户希望的氛围：${moodHint}` : ""}

请严格按照以下 JSON 格式返回（不要有任何额外文字）：
{
  "mood": "整体情绪描述，10字以内",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "relationshipTone": "两人关系氛围，10字以内",
  "topics": ["主题词1", "主题词2", "主题词3", "主题词4", "主题词5", "主题词6", "主题词7", "主题词8", "主题词9", "主题词10", "主题词11", "主题词12"]
}

主题词要求：
- 每个主题词 2-5 个汉字
- 优先用名词、地点、颜色、天气、动作或状态
- 不要出现"适合失恋时听"这种过于具体的描述
- 不要出现敏感或隐私信息
- 12个主题词要各不相同`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      mood: parsed.mood || "轻松自然",
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      relationshipTone: parsed.relationshipTone || "熟悉友好",
      topics: Array.isArray(parsed.topics) && parsed.topics.length >= 8
        ? parsed.topics
        : DEFAULT_TOPICS.slice(0, 12),
    };
  } catch {
    return {
      mood: "轻松自然",
      keywords: [],
      relationshipTone: "熟悉友好",
      topics: DEFAULT_TOPICS.slice(0, 12),
    };
  }
}

// 根据氛围描述生成主题
export async function generateTopicsFromMood(moodHint: string): Promise<string[]> {
  const prompt = `你是一个音乐抽签活动的主持人。请根据以下氛围描述，生成适合双人音乐抽签活动的发散主题词列表。

氛围描述：${moodHint}

请严格按照以下 JSON 格式返回（不要有任何额外文字）：
{
  "topics": ["主题词1", "主题词2", "主题词3", "主题词4", "主题词5", "主题词6", "主题词7", "主题词8", "主题词9", "主题词10", "主题词11", "主题词12"]
}

主题词要求：
- 每个主题词 2-5 个汉字
- 优先用名词、地点、颜色、天气、动作或状态
- 不要出现过于具体的描述
- 12个主题词要各不相同`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.8,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    if (Array.isArray(parsed.topics) && parsed.topics.length >= 8) {
      return parsed.topics;
    }
    return DEFAULT_TOPICS.slice(0, 12);
  } catch {
    return DEFAULT_TOPICS.slice(0, 12);
  }
}

// 生成双人音乐局总结
export async function generateSummary(
  roomName: string,
  entries: Array<{
    nickname: string;
    topic: string;
    songName: string;
    artist: string;
    reason?: string;
  }>
): Promise<SummaryResult> {
  const entriesText = entries
    .map(
      (e) =>
        `${e.nickname} 抽到主题「${e.topic}」，分享了《${e.songName}》- ${e.artist}${e.reason ? `，理由：${e.reason}` : ""}`
    )
    .join("\n");

  const prompt = `你是一个音乐局的旁观者。请根据以下信息，为这场双人音乐抽签局写一段总结文案。

音乐局名称：${roomName}
参与情况：
${entriesText}

请严格按照以下 JSON 格式返回（不要有任何额外文字）：
{
  "summary": "总结文案",
  "tags": ["标签1", "标签2", "标签3", "标签4"]
}

总结文案要求：
- 50-80字，不超过两句话
- 用第三人称或旁观者视角
- 用场景感、画面感的意象表达，例如夜路、海边、窗帘、月台
- 绝对不要出现"你们真的很有默契""这两首歌都很好听"之类的套话
- 不直接评价音乐好坏，只描述两首歌组合在一起的氛围感
- 保留一些模糊感，不要过度解释
标签要求：
- 3-4个标签，每个2-4个汉字
- 类似"夜晚、安静、松弛"这样的风格`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      summary: parsed.summary || "这场音乐局留下了两首各自的回响。",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch {
    return {
      summary: "这场音乐局留下了两首各自的回响。",
      tags: [],
    };
  }
}

export const DEFAULT_TOPICS = [
  "天空", "蓝色", "雨天", "海边", "公路", "开车",
  "北方", "南方", "东京", "夜晚", "清晨", "宇宙",
  "房间", "离开", "等待", "自由", "孤独", "热烈",
  "松弛", "旧照片", "便利店", "火车", "山", "风",
  "霓虹灯", "操场", "日落", "月亮", "失眠",
];
