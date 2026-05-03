"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSession } from "@/lib/utils";

type TopicMode = "default" | "ai_mood" | "ai_chat";

export default function HomePage() {
  const router = useRouter();
  const [roomName, setRoomName] = useState("");
  const [nickname, setNickname] = useState("");
  const [topicMode, setTopicMode] = useState<TopicMode>("default");
  const [moodHint, setMoodHint] = useState("");
  const [chatText, setChatText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    setError("");
    if (!roomName.trim()) return setError("请输入房间名");
    if (!nickname.trim()) return setError("请输入你的昵称");
    if (topicMode === "ai_mood" && !moodHint.trim()) return setError("请输入氛围描述");
    if (topicMode === "ai_chat" && !chatText.trim()) return setError("请粘贴聊天记录");

    setLoading(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomName, nickname, topicMode, moodHint, chatText }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || "创建失败");

      saveSession(data.roomId, data.participantId, data.sessionToken);
      router.push(`/room/${data.inviteCode}`);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* 标题 */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">🎵</div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">今天听什么局</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            创建一个双人音乐抽签局。<br />
            你们各自抽一个主题，然后分享一首和它有关的歌。
          </p>
        </div>

        {/* 表单 */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">房间名</label>
            <input
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
              placeholder="例如：今晚听什么、五一听歌局"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              maxLength={30}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">你的昵称</label>
            <input
              className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
              placeholder="叫什么都行"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
            />
          </div>

          {/* 主题生成方式 */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">主题从哪来</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "default", label: "默认主题", icon: "🎲" },
                { value: "ai_mood", label: "按氛围生成", icon: "✨" },
                { value: "ai_chat", label: "聊天记录", icon: "💬" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTopicMode(opt.value as TopicMode)}
                  className={`py-3 px-2 rounded-xl border text-sm font-medium transition flex flex-col items-center gap-1 ${
                    topicMode === opt.value
                      ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                      : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500"
                  }`}
                >
                  <span className="text-xl">{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {topicMode === "ai_mood" && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">氛围描述</label>
              <input
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
                placeholder="例如：想要轻松一点、公路感、夜晚城市"
                value={moodHint}
                onChange={(e) => setMoodHint(e.target.value)}
                maxLength={50}
              />
            </div>
          )}

          {topicMode === "ai_chat" && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                粘贴聊天记录
                <span className="ml-2 text-xs text-gray-600">请先删除敏感信息</span>
              </label>
              <textarea
                className="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition resize-none"
                placeholder="把你们的聊天记录粘贴进来，AI 会从里面提取氛围，生成主题..."
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                rows={5}
                maxLength={3000}
              />
              <p className="text-xs text-gray-600 mt-1">最多 3000 字</p>
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-white transition text-lg mt-2"
          >
            {loading
              ? topicMode === "default"
                ? "创建中..."
                : "AI 生成主题中..."
              : "创建抽签局"}
          </button>
        </div>
      </div>
    </main>
  );
}
