import { Annotation } from "@langchain/langgraph";

export interface PersonalityProfile {
  nickname: string;
  participantId: string;
  traits: string[];
  musicStyle: string;
}

export interface RelationshipAnalysis {
  type: string;
  tone: string;
  sharedMoments: string[];
}

export interface ExecutionLogEntry {
  node: string;
  startAt: string;
  endAt: string;
  durationMs: number;
  type: "llm" | "human" | "route";
  summary: string;
  thinking?: string;
}

export interface NextSongRecommendation {
  songName: string;
  artist: string;
  reason: string;
  neteaseUrl?: string;  // 验证通过后由 searchNeteaseTool 填充
  coverUrl?: string;    // 专辑封面
}

// 完整的业务状态类型，用于数据库序列化和 API 响应
export interface MusicDrawState {
  roomId: string;
  roomName: string;
  inviteCode: string;

  hostConversation: Array<{ role: "user" | "assistant"; content: string }>;
  hostConversationDone: boolean;

  chatText?: string;
  moodHint?: string;

  personalityProfiles: PersonalityProfile[];
  relationshipAnalysis?: RelationshipAnalysis;
  extractedMood: string;
  extractedKeywords: string[];

  topics: string[];
  topicSource: "default" | "ai";

  participants: Array<{
    id: string;
    nickname: string;
    drawnTopic?: string;
    entry?: {
      songName: string;
      artist: string;
      musicUrl?: string;
      reason?: string;
    };
  }>;

  phase:
    | "init"
    | "analyzing"
    | "topics_ready"
    | "drawing"
    | "collecting"
    | "summarizing"
    | "done"
    | "error";

  summary?: string;
  tags?: string[];
  nextSongRecommendation?: NextSongRecommendation;

  executionLog: ExecutionLogEntry[];

  error?: string;
  retryCount: number;
}

// ──────────────────────────────────────────────
// LangGraph Annotation：分析子图（分析聊天 + 生成主题）
// 使用 v1 API：reducer 字段改名为 value
// ──────────────────────────────────────────────

export const AnalysisAnnotation = Annotation.Root({
  // 输入字段（last-write-wins，无默认值）
  chatText: Annotation<string | undefined>({
    value: (_prev, next) => next,
    default: () => undefined,
  }),
  moodHint: Annotation<string | undefined>({
    value: (_prev, next) => next,
    default: () => undefined,
  }),
  hostConversationSummary: Annotation<string>({
    value: (_prev, next) => next,
    default: () => "",
  }),

  // 输出字段（overwrite）
  personalityProfiles: Annotation<PersonalityProfile[]>({
    value: (_prev, next) => next,
    default: () => [],
  }),
  relationshipAnalysis: Annotation<RelationshipAnalysis | undefined>({
    value: (_prev, next) => next,
    default: () => undefined,
  }),
  extractedMood: Annotation<string>({
    value: (_prev, next) => next,
    default: () => "",
  }),
  extractedKeywords: Annotation<string[]>({
    value: (_prev, next) => next,
    default: () => [],
  }),
  topics: Annotation<string[]>({
    value: (_prev, next) => next,
    default: () => [],
  }),
  topicSource: Annotation<"default" | "ai">({
    value: (_prev, next) => next,
    default: () => "default" as const,
  }),

  // 执行日志（追加模式）
  executionLog: Annotation<ExecutionLogEntry[]>({
    value: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});

// ──────────────────────────────────────────────
// LangGraph Annotation：总结子图
// ──────────────────────────────────────────────

export interface ParticipantForSummary {
  id: string;
  nickname: string;
  drawnTopic: string;
  traits: string[];
  musicStyle: string;
  entry: {
    songName: string;
    artist: string;
    reason?: string;
  };
}

export const SummaryAnnotation = Annotation.Root({
  roomName: Annotation<string>({
    value: (_prev, next) => next,
    default: () => "",
  }),
  participants: Annotation<ParticipantForSummary[]>({
    value: (_prev, next) => next,
    default: () => [],
  }),
  relationshipAnalysis: Annotation<RelationshipAnalysis | undefined>({
    value: (_prev, next) => next,
    default: () => undefined,
  }),

  summary: Annotation<string | undefined>({
    value: (_prev, next) => next,
    default: () => undefined,
  }),
  tags: Annotation<string[] | undefined>({
    value: (_prev, next) => next,
    default: () => undefined,
  }),
  nextSongRecommendation: Annotation<NextSongRecommendation | undefined>({
    value: (_prev, next) => next,
    default: () => undefined,
  }),

  executionLog: Annotation<ExecutionLogEntry[]>({
    value: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});
