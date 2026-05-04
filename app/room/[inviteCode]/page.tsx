"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSession, saveSession } from "@/lib/utils";

interface Participant {
  id: string;
  nickname: string;
  drawnTopic: string | null;
  hasEntry: boolean;
}

interface Entry {
  id: string;
  participantId: string;
  topic: string;
  songName: string;
  artist: string;
  musicUrl?: string;
  reason?: string;
}

interface PersonalityProfile {
  nickname: string;
  participantId: string;
  traits: string[];
  musicStyle: string;
}

interface RelationshipAnalysis {
  type: string;
  tone: string;
  sharedMoments: string[];
}

interface NextSongRecommendation {
  songName: string;
  artist: string;
  reason: string;
  neteaseUrl?: string;
  coverUrl?: string;
}

interface SongSuggestion {
  id: number;
  name: string;
  artist: string;
  album: string;
  url: string;
  cover?: string;
}

interface ExecutionLogEntry {
  node: string;
  startAt: string;
  endAt: string;
  durationMs: number;
  type: "llm" | "human" | "route";
  summary: string;
  thinking?: string;
}

interface RoomData {
  id: string;
  name: string;
  inviteCode: string;
  status: string;
  topics: string[];
  participants: Participant[];
  entries: Entry[];
  aiSummary?: string;
  aiTags?: string[];
  // V2 Agent 字段
  agentPhase?: string;
  agentPersonalityProfiles?: PersonalityProfile[];
  agentRelationship?: RelationshipAnalysis | null;
  agentNextSong?: NextSongRecommendation | null;
  agentExecutionLog?: ExecutionLogEntry[];
}

type Stage = "waiting" | "draw" | "submit" | "result";

// ──────────────────────────────────────────────
// 子组件：性格卡
// ──────────────────────────────────────────────

function PersonalityCards({
  profiles,
  relationship,
  participants,
}: {
  profiles: PersonalityProfile[];
  relationship?: RelationshipAnalysis | null;
  participants: Participant[];
}) {
  if (!profiles || profiles.length === 0) return null;

  // 将 profiles 和 participants 对应（按顺序）
  const enrichedProfiles = profiles.map((p, i) => ({
    ...p,
    nickname: p.nickname || participants[i]?.nickname || `参与者${i + 1}`,
  }));

  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800 space-y-3">
      <p className="text-xs text-gray-500 mb-1">🎭 你们这次的状态</p>
      {enrichedProfiles.map((profile, i) => (
        <div key={i} className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white">{profile.nickname}</span>
            {profile.traits.map((t) => (
              <span
                key={t}
                className="text-xs text-indigo-300 bg-indigo-400/10 px-2 py-0.5 rounded-full"
              >
                {t}
              </span>
            ))}
          </div>
          {profile.musicStyle && (
            <p className="text-xs text-gray-500 ml-0.5">{profile.musicStyle}</p>
          )}
        </div>
      ))}
      {relationship && (
        <div className="pt-2 border-t border-gray-800 space-y-1">
          <p className="text-xs text-gray-400">
            你们的关系：
            <span className="text-gray-300">
              {relationship.type}，{relationship.tone}
            </span>
          </p>
          {relationship.sharedMoments?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {relationship.sharedMoments.map((m, i) => (
                <span key={i} className="text-xs text-gray-500 italic">
                  「{m}」
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 子组件：下一首推荐
// ──────────────────────────────────────────────

function NextSongCard({ rec }: { rec: NextSongRecommendation }) {
  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
      <p className="text-xs text-gray-500 mb-3">🎵 如果还想听一首</p>
      <div className="flex items-start gap-3">
        {rec.coverUrl ? (
          <img
            src={rec.coverUrl}
            alt={rec.songName}
            className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-indigo-600/30 flex items-center justify-center text-lg flex-shrink-0">
            ♫
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-white">《{rec.songName}》</p>
          <p className="text-sm text-gray-400">{rec.artist}</p>
          {rec.reason && (
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">{rec.reason}</p>
          )}
          {rec.neteaseUrl && (
            <a
              href={rec.neteaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 mt-2 transition"
            >
              <span>在网易云听</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </div>
      {!rec.neteaseUrl && (
        <p className="text-xs text-gray-700 mt-3">* AI 推荐，网易云验证中</p>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 子组件：Agent 执行日志
// ──────────────────────────────────────────────

const NODE_LABELS: Record<string, string> = {
  hostChatNode: "主持人对话",
  analyzeChatNode: "聊天深度分析",
  generateTopicsNode: "主题生成",
  waitForDrawNode: "抽签",
  waitForEntriesNode: "提交音乐",
  generateSummaryNode: "总结与推荐",
};

function AgentExecutionLog({ logs }: { logs: ExecutionLogEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!logs || logs.length === 0) return null;

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 flex items-center justify-between text-left"
      >
        <span className="text-sm text-gray-400">查看 AI 的工作过程</span>
        <span className="text-gray-600 text-xs">{expanded ? "收起 ▲" : "展开 ▼"}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-2 border-t border-gray-800 pt-4">
          {logs.map((log, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-start gap-2">
                <span
                  className={`mt-0.5 text-xs flex-shrink-0 ${
                    log.type === "llm"
                      ? "text-indigo-400"
                      : log.type === "human"
                      ? "text-green-400"
                      : "text-gray-500"
                  }`}
                >
                  {log.type === "human" ? "👤" : log.type === "llm" ? "🤖" : "→"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-300">
                      {NODE_LABELS[log.node] || log.node}
                    </span>
                    {log.durationMs > 0 && (
                      <span className="text-xs text-gray-600">
                        {(log.durationMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{log.summary}</p>
                  {log.thinking && (
                    <button
                      onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                      className="text-xs text-indigo-500 hover:text-indigo-400 mt-1"
                    >
                      {expandedIdx === i ? "收起推理过程" : "查看原始输出"}
                    </button>
                  )}
                  {expandedIdx === i && log.thinking && (
                    <pre className="mt-1 text-xs text-gray-600 bg-gray-800/50 rounded-lg p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                      {log.thinking.slice(0, 500)}
                      {log.thinking.length > 500 ? "..." : ""}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 主页面
// ──────────────────────────────────────────────

export default function RoomPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const router = useRouter();

  const [room, setRoom] = useState<RoomData | null>(null);
  const [stage, setStage] = useState<Stage>("waiting");
  const [me, setMe] = useState<Participant | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [songName, setSongName] = useState("");
  const [artist, setArtist] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [reason, setReason] = useState("");
  const [submitError, setSubmitError] = useState("");

  // 歌曲搜索联想
  const [suggestions, setSuggestions] = useState<SongSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionRef = useRef<HTMLDivElement>(null);

  const [drawing, setDrawing] = useState(false);
  const [drawnTopic, setDrawnTopic] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 歌曲搜索联想 ────────────────────────────
  const handleSongNameChange = (value: string) => {
    setSongName(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!value.trim()) { setSuggestions([]); setShowSuggestions(false); return; }

    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/music/search?q=${encodeURIComponent(value)}&limit=5`);
        const data = await res.json();
        if (data.songs?.length > 0) {
          setSuggestions(data.songs);
          setShowSuggestions(true);
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch {
        setSuggestions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400); // 400ms 防抖
  };

  const handleSelectSuggestion = (song: SongSuggestion) => {
    setSongName(song.name);
    setArtist(song.artist);
    if (!musicUrl) setMusicUrl(song.url); // 只在用户没填链接时自动填
    setSuggestions([]);
    setShowSuggestions(false);
  };

  const fetchRoom = useCallback(async () => {
    try {
      const res = await fetch(`/api/rooms/${inviteCode}`);
      if (res.status === 404) { router.push("/"); return; }
      if (res.status === 410) { setError("房间已过期"); setLoading(false); return; }
      const data: RoomData = await res.json();
      setRoom(data);

      const session = getSession(data.id);
      if (session) {
        const participant = data.participants.find((p) => p.id === session.participantId);
        if (participant) {
          setMe(participant);
          if (data.status === "completed" || data.aiSummary) {
            setStage("result");
          } else if (participant.hasEntry) {
            setStage("result");
          } else if (participant.drawnTopic) {
            setDrawnTopic(participant.drawnTopic);
            setStage("submit");
          } else if (data.participants.length >= 2) {
            setStage("draw");
          } else {
            setStage("waiting");
          }
        }
      } else {
        if (data.status === "completed" || data.aiSummary) {
          setStage("result");
        } else if (data.participants.length < 2) {
          router.push(`/join/${inviteCode}`);
          return;
        }
      }
    } catch {
      // 静默处理
    } finally {
      setLoading(false);
    }
  }, [inviteCode, router]);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  useEffect(() => {
    if (stage === "waiting" || stage === "draw" || (stage === "submit" && room?.status !== "completed")) {
      pollRef.current = setInterval(async () => {
        if (document.hidden) return;
        const res = await fetch(`/api/rooms/${inviteCode}`);
        if (!res.ok) return;
        const data: RoomData = await res.json();
        setRoom(data);

        const session = getSession(data.id);
        if (session) {
          const participant = data.participants.find((p) => p.id === session.participantId);
          if (participant) setMe(participant);
        }

        if (data.status === "completed") { setStage("result"); clearInterval(pollRef.current!); }
        if (stage === "waiting" && data.participants.length >= 2) setStage("draw");
      }, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [stage, inviteCode, room]);

  async function handleDraw() {
    if (!me || !room) return;
    const session = getSession(room.id);
    if (!session) return;

    setDrawing(true);
    setActionLoading(true);
    try {
      const res = await fetch(`/api/rooms/${room.id}/draw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: session.participantId, sessionToken: session.sessionToken }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error);
      setDrawnTopic(data.topic);
      setTimeout(() => {
        setDrawing(false);
        setStage("submit");
      }, 1500);
    } catch {
      setError("抽签失败，请重试");
      setDrawing(false);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSubmit() {
    if (!me || !room || !drawnTopic) return;
    setSubmitError("");
    if (!songName.trim()) return setSubmitError("歌名不能为空");
    if (!artist.trim()) return setSubmitError("歌手不能为空");

    const session = getSession(room.id);
    if (!session) return;

    setActionLoading(true);
    try {
      const res = await fetch(`/api/rooms/${room.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: session.participantId,
          sessionToken: session.sessionToken,
          songName, artist, musicUrl, reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) return setSubmitError(data.error);

      await fetchRoom();
      setStage("result");
    } catch {
      setSubmitError("提交失败，请重试");
    } finally {
      setActionLoading(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(window.location.origin + `/join/${inviteCode}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500 animate-pulse">加载中...</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-4">{error}</p>
          <button onClick={() => router.push("/")} className="text-indigo-400 hover:underline">返回首页</button>
        </div>
      </main>
    );
  }

  if (!room) return null;

  const participants = room.participants ?? [];
  const entries = room.entries ?? [];
  const otherParticipant = participants.find((p) => p.id !== me?.id);
  const myEntry = entries.find((e) => e.participantId === me?.id);
  const otherEntry = entries.find((e) => e.participantId !== me?.id);
  void otherParticipant; void myEntry; void otherEntry;

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">

        {/* 房间名 */}
        <div className="text-center">
          <h1 className="text-2xl font-bold">{room.name}</h1>
          <p className="text-gray-500 text-sm mt-1">音乐抽签局</p>
        </div>

        {/* 等待阶段 */}
        {stage === "waiting" && (
          <div className="bg-gray-900 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold">
                {me?.nickname?.[0]?.toUpperCase() || "?"}
              </div>
              <span className="text-sm">{me?.nickname || "你"}</span>
              <span className="ml-auto text-xs text-green-400 bg-green-400/10 px-2 py-1 rounded-full">已加入</span>
            </div>
            <div className="border-t border-gray-800 pt-4">
              <p className="text-gray-400 text-sm mb-3">把链接发给另一个人</p>
              <button
                onClick={copyLink}
                className="w-full py-3 rounded-xl border border-dashed border-gray-700 text-gray-400 hover:border-indigo-500 hover:text-indigo-400 transition text-sm"
              >
                {copied ? "✓ 已复制" : "复制邀请链接"}
              </button>
            </div>
            <p className="text-xs text-gray-600 text-center animate-pulse">等待对方加入...</p>
          </div>
        )}

        {/* 抽签阶段 */}
        {stage === "draw" && (
          <div className="bg-gray-900 rounded-2xl p-6 text-center space-y-6">
            <div>
              <p className="text-gray-400 text-sm mb-1">两个人都到了</p>
              <p className="text-lg font-semibold">可以开始抽签了</p>
            </div>

            <div className="flex justify-center gap-8 text-sm text-gray-400">
              {participants.map((p) => (
                <div key={p.id} className="flex flex-col items-center gap-2">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${p.id === me?.id ? "bg-indigo-600" : "bg-gray-700"}`}>
                    {p.nickname[0].toUpperCase()}
                  </div>
                  <span>{p.nickname}</span>
                  {p.drawnTopic ? (
                    <span className="text-xs text-green-400">已抽签</span>
                  ) : (
                    <span className="text-xs text-gray-600">未抽签</span>
                  )}
                </div>
              ))}
            </div>

            {!me?.drawnTopic ? (
              <button
                onClick={handleDraw}
                disabled={actionLoading || drawing}
                className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold transition text-lg"
              >
                {drawing ? "抽签中..." : "抽一个主题"}
              </button>
            ) : (
              <div className="py-4 rounded-xl bg-gray-800 text-gray-400 text-sm">
                你已抽到「{me.drawnTopic}」，等待对方完成...
              </div>
            )}

            <p className="text-xs text-gray-600">
              你的主题会是一个词，也可能是一段回忆的入口。
            </p>
          </div>
        )}

        {/* 抽签动效遮罩 */}
        {drawing && drawnTopic && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div className="text-center animate-bounce">
              <p className="text-gray-400 text-sm mb-4">你抽到的主题是</p>
              <div className="text-6xl font-black text-white tracking-widest">{drawnTopic}</div>
            </div>
          </div>
        )}

        {/* 提交音乐阶段 */}
        {stage === "submit" && drawnTopic && (
          <div className="space-y-4">
            <div className="bg-gray-900 rounded-2xl p-6 text-center">
              <p className="text-gray-400 text-sm mb-2">你抽到的主题</p>
              <div className="text-4xl font-black text-white tracking-widest">{drawnTopic}</div>
              <p className="text-gray-600 text-xs mt-3">分享一首和它有关的歌</p>
            </div>

            <div className="bg-gray-900 rounded-2xl p-6 space-y-4">
              {/* 歌名（带搜索联想） */}
              <div className="relative">
                <label className="block text-sm text-gray-400 mb-1">
                  歌名 *
                  {searchLoading && (
                    <span className="ml-2 text-xs text-indigo-400 animate-pulse">搜索中...</span>
                  )}
                </label>
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
                  placeholder="叫什么名字（输入可搜索网易云）"
                  value={songName}
                  onChange={(e) => handleSongNameChange(e.target.value)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  autoComplete="off"
                />
                {/* 搜索建议下拉 */}
                {showSuggestions && suggestions.length > 0 && (
                  <div
                    ref={suggestionRef}
                    className="absolute top-full left-0 right-0 z-50 mt-1 bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl"
                  >
                    {suggestions.map((song) => (
                      <button
                        key={song.id}
                        type="button"
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-700 transition border-b border-gray-700 last:border-b-0"
                        onMouseDown={() => handleSelectSuggestion(song)}
                      >
                        {song.cover && (
                          <img
                            src={song.cover}
                            alt={song.name}
                            className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-medium truncate">《{song.name}》</p>
                          <p className="text-xs text-gray-400 truncate">{song.artist} · {song.album}</p>
                        </div>
                        <a
                          href={song.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-indigo-400 hover:text-indigo-300 flex-shrink-0"
                          title="在网易云打开"
                        >
                          试听
                        </a>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">歌手 *</label>
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
                  placeholder="谁唱的"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">链接 <span className="text-gray-600">可选</span></label>
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
                  placeholder="选择网易云歌曲后自动填入"
                  value={musicUrl}
                  onChange={(e) => setMusicUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">为什么推荐这首 <span className="text-gray-600">可选</span></label>
                <textarea
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition resize-none"
                  placeholder="几个字就够了"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  maxLength={100}
                />
              </div>

              {submitError && <p className="text-red-400 text-sm">{submitError}</p>}

              <button
                onClick={handleSubmit}
                disabled={actionLoading}
                className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold transition text-lg"
              >
                {actionLoading ? "提交中..." : "提交这首歌"}
              </button>
            </div>
          </div>
        )}

        {/* 结果阶段 */}
        {stage === "result" && (
          <div className="space-y-4">
            <p className="text-center text-gray-400 text-sm">这是你们今天抽到的两首歌。</p>

            {/* 两人结果卡片 */}
            {entries.length < 2 ? (
              <div className="bg-gray-900 rounded-2xl p-6 text-center">
                <p className="text-gray-400 text-sm animate-pulse">等待对方提交音乐...</p>
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => {
                  const p = participants.find((p) => p.id === entry.participantId);
                  const isMe = p?.id === me?.id;
                  return (
                    <div key={entry.id} className={`rounded-2xl p-5 border ${isMe ? "bg-indigo-950/40 border-indigo-800" : "bg-gray-900 border-gray-800"}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isMe ? "bg-indigo-600" : "bg-gray-700"}`}>
                          {p?.nickname?.[0]?.toUpperCase()}
                        </div>
                        <span className="text-sm font-medium">{p?.nickname}</span>
                        {isMe && <span className="text-xs text-indigo-400">（你）</span>}
                      </div>
                      <div className="mb-2">
                        <span className="text-xs text-gray-500">主题 </span>
                        <span className="text-indigo-300 font-semibold">「{entry.topic}」</span>
                      </div>
                      <div className="text-lg font-bold mb-0.5">
                        {entry.musicUrl ? (
                          <a href={entry.musicUrl} target="_blank" rel="noopener noreferrer" className="hover:text-indigo-300 transition">
                            《{entry.songName}》
                          </a>
                        ) : (
                          <span>《{entry.songName}》</span>
                        )}
                      </div>
                      <div className="text-sm text-gray-400">{entry.artist}</div>
                      {entry.reason && (
                        <div className="mt-2 text-sm text-gray-500 italic">"{entry.reason}"</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* AI 总结 */}
            {entries.length >= 2 && (
              <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
                {!room.aiSummary ? (
                  <p className="text-gray-500 text-sm text-center animate-pulse">AI 正在感受这场音乐局...</p>
                ) : (
                  <div>
                    <p className="text-xs text-gray-600 mb-2">AI 总结</p>
                    <p className="text-gray-300 text-sm leading-relaxed">{room.aiSummary}</p>
                    {room.aiTags && room.aiTags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {room.aiTags.map((tag) => (
                          <span key={tag} className="text-xs text-indigo-400 bg-indigo-400/10 px-2 py-1 rounded-full">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 性格卡（V2） */}
            {entries.length >= 2 &&
              room.agentPersonalityProfiles &&
              room.agentPersonalityProfiles.length > 0 && (
                <PersonalityCards
                  profiles={room.agentPersonalityProfiles}
                  relationship={room.agentRelationship}
                  participants={participants}
                />
              )}

            {/* 下一首推荐（V2） */}
            {entries.length >= 2 && room.agentNextSong && (
              <NextSongCard rec={room.agentNextSong} />
            )}

            {/* Agent 执行日志（V2） */}
            {entries.length >= 2 &&
              room.agentExecutionLog &&
              room.agentExecutionLog.length > 0 && (
                <AgentExecutionLog logs={room.agentExecutionLog} />
              )}

            {/* 分享 */}
            <div className="flex gap-3">
              <button
                onClick={copyLink}
                className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:border-gray-500 transition"
              >
                {copied ? "✓ 已复制" : "复制分享链接"}
              </button>
              <button
                onClick={() => {
                  if (!entries.length) return;
                  const text = entries.map((e) => {
                    const p = participants.find((p) => p.id === e.participantId);
                    return `${p?.nickname}｜主题：${e.topic}｜《${e.songName}》- ${e.artist}`;
                  }).join("\n");
                  navigator.clipboard.writeText(`${room.name}\n\n${text}${room.aiSummary ? "\n\n" + room.aiSummary : ""}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex-1 py-3 rounded-xl border border-gray-700 text-sm text-gray-400 hover:border-gray-500 transition"
              >
                复制歌单
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
