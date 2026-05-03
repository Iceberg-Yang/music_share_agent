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
}

type Stage = "waiting" | "draw" | "submit" | "result";

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

  // 提交音乐表单
  const [songName, setSongName] = useState("");
  const [artist, setArtist] = useState("");
  const [musicUrl, setMusicUrl] = useState("");
  const [reason, setReason] = useState("");
  const [submitError, setSubmitError] = useState("");

  // 抽签动效
  const [drawing, setDrawing] = useState(false);
  const [drawnTopic, setDrawnTopic] = useState<string | null>(null);

  // 总结生成
  const [summaryLoading, setSummaryLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
          // 根据状态决定 stage
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
        // 无 session，说明是第三方查看或链接分享
        if (data.status === "completed" || data.aiSummary) {
          setStage("result");
        } else if (data.participants.length < 2) {
          // 引导去加入
          router.push(`/join/${inviteCode}`);
          return;
        }
      }
    } catch {
      // 网络错误静默处理
    } finally {
      setLoading(false);
    }
  }, [inviteCode, router]);

  // 检查是否需要自动生成总结
  const checkAndGenerateSummary = useCallback(async (r: RoomData) => {
    if (r.status === "submitted" && !r.aiSummary && !summaryLoading) {
      setSummaryLoading(true);
      try {
        const res = await fetch(`/api/rooms/${r.id}/summary`, { method: "POST" });
        if (res.ok) {
          await fetchRoom();
          setStage("result");
        }
      } finally {
        setSummaryLoading(false);
      }
    }
    if (r.status === "completed") setStage("result");
  }, [fetchRoom, summaryLoading]);

  useEffect(() => {
    fetchRoom();
  }, [fetchRoom]);

  // 轮询
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

        if (data.status === "submitted") checkAndGenerateSummary(data);
        if (data.status === "completed") { setStage("result"); clearInterval(pollRef.current!); }
        if (stage === "waiting" && data.participants.length >= 2) setStage("draw");
      }, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [stage, inviteCode, checkAndGenerateSummary, room]);

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
              <div>
                <label className="block text-sm text-gray-400 mb-1">歌名 *</label>
                <input
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
                  placeholder="叫什么名字"
                  value={songName}
                  onChange={(e) => setSongName(e.target.value)}
                />
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
                  placeholder="网易云 / QQ 音乐链接"
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
                {summaryLoading && (
                  <p className="text-gray-500 text-sm text-center animate-pulse">AI 正在感受这场音乐局...</p>
                )}
                {room.aiSummary && (
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
                {!summaryLoading && !room.aiSummary && room.status === "submitted" && (
                  <button
                    onClick={async () => {
                      setSummaryLoading(true);
                      const res = await fetch(`/api/rooms/${room.id}/summary`, { method: "POST" });
                      if (res.ok) await fetchRoom();
                      setSummaryLoading(false);
                    }}
                    className="w-full text-sm text-gray-400 hover:text-white transition"
                  >
                    生成 AI 总结
                  </button>
                )}
              </div>
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
