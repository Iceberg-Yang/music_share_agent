"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { saveSession } from "@/lib/utils";
import { getUserId } from "@/lib/memory/userIdentity";

type TopicMode = "default" | "ai_mood" | "ai_chat" | "ai_host";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ExtractedInfo {
  moodHint: string;
  keywords: string[];
}

interface WelcomeInfo {
  gamesPlayed: number;
  nickname?: string;
  lastSong?: string;
  lastArtist?: string;
  styles?: string[];
}

export default function HomePage() {
  const router = useRouter();
  const [roomName, setRoomName] = useState("");
  const [nickname, setNickname] = useState("");
  const [topicMode, setTopicMode] = useState<TopicMode>("default");
  const [moodHint, setMoodHint] = useState("");
  const [chatText, setChatText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // V4：欢迎回来
  const [welcome, setWelcome] = useState<WelcomeInfo | null>(null);

  // 主持人对话状态
  const [hostMessages, setHostMessages] = useState<ChatMessage[]>([]);
  const [hostInput, setHostInput] = useState("");
  const [hostLoading, setHostLoading] = useState(false);
  const [hostDone, setHostDone] = useState(false);
  const [extractedInfo, setExtractedInfo] = useState<ExtractedInfo | null>(null);
  const [hostStarted, setHostStarted] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [hostMessages]);

  // V4：加载欢迎回来数据
  useEffect(() => {
    const uid = getUserId();
    if (!uid) return;
    fetch(`/api/memory/user?userId=${encodeURIComponent(uid)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.gamesPlayed > 0) {
          setWelcome(data);
          if (data.nickname) setNickname(data.nickname);
        }
      })
      .catch(() => {});
  }, []);

  // 开始主持人对话（发送第一条空消息触发 AI 打招呼）
  async function startHostChat() {
    setHostStarted(true);
    setHostLoading(true);
    try {
      const res = await fetch("/api/rooms/host-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "你好，我想开始一个音乐抽签局", conversationHistory: [] }),
      });
      const data = await res.json();
      if (res.ok) {
        setHostMessages([{ role: "assistant", content: data.reply }]);
        if (data.isDone) {
          setHostDone(true);
          if (data.extractedInfo) setExtractedInfo(data.extractedInfo);
        }
      }
    } catch {
      setHostMessages([{ role: "assistant", content: "嗨！这次音乐局打算和谁一起玩？" }]);
    } finally {
      setHostLoading(false);
    }
  }

  async function sendHostMessage() {
    if (!hostInput.trim() || hostLoading || hostDone) return;
    const userMsg = hostInput.trim();
    setHostInput("");

    const newHistory: ChatMessage[] = [...hostMessages, { role: "user", content: userMsg }];
    setHostMessages(newHistory);
    setHostLoading(true);

    try {
      const res = await fetch("/api/rooms/host-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          conversationHistory: hostMessages,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setHostMessages([...newHistory, { role: "assistant", content: data.reply }]);
        if (data.isDone) {
          setHostDone(true);
          if (data.extractedInfo) setExtractedInfo(data.extractedInfo);
        }
      }
    } catch {
      setHostMessages([...newHistory, { role: "assistant", content: "网络有点问题，我们直接开始吧~" }]);
      setHostDone(true);
    } finally {
      setHostLoading(false);
    }
  }

  async function handleCreate() {
    setError("");
    if (!roomName.trim()) return setError("请输入房间名");
    if (!nickname.trim()) return setError("请输入你的昵称");
    if (topicMode === "ai_mood" && !moodHint.trim()) return setError("请输入氛围描述");
    if (topicMode === "ai_chat" && !chatText.trim()) return setError("请粘贴聊天记录");

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        roomName, nickname, topicMode, moodHint, chatText,
        userId: getUserId(),
      };

      // 如果有主持人对话，传入历史
      if (topicMode === "ai_host" && hostMessages.length > 0) {
        body.topicMode = "ai_mood"; // 走 AI 生成流程
        body.moodHint = extractedInfo?.moodHint || "";
        body.hostConversationHistory = hostMessages;
      }

      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const canCreate =
    topicMode !== "ai_host" ||
    (hostDone && hostMessages.length > 0);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* 欢迎回来横幅（V4）*/}
        {welcome && welcome.gamesPlayed > 0 && (
          <div className="mb-6 bg-indigo-950/50 border border-indigo-800/60 rounded-2xl px-4 py-3 text-sm">
            <p className="text-indigo-300 font-medium mb-0.5">
              欢迎回来{welcome.nickname ? `，${welcome.nickname}` : ""}！
            </p>
            <p className="text-gray-400 text-xs">
              已玩 {welcome.gamesPlayed} 局
              {welcome.lastSong ? `，上次选了《${welcome.lastSong}》` : ""}
              {welcome.styles?.length ? `，偏好：${welcome.styles.slice(0, 2).join(" / ")}` : ""}
            </p>
          </div>
        )}

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
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "default", label: "默认主题", icon: "🎲", desc: "随机发散词" },
                { value: "ai_mood", label: "按氛围生成", icon: "✨", desc: "描述一下心情" },
                { value: "ai_chat", label: "聊天记录", icon: "💬", desc: "粘贴你们的聊天" },
                { value: "ai_host", label: "和主持人聊", icon: "🎙", desc: "AI 来问你几个问题" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setTopicMode(opt.value as TopicMode);
                    if (opt.value === "ai_host" && !hostStarted) startHostChat();
                  }}
                  className={`py-3 px-3 rounded-xl border text-sm font-medium transition flex flex-col items-start gap-0.5 ${
                    topicMode === opt.value
                      ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                      : "border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-500"
                  }`}
                >
                  <span className="text-xl">{opt.icon}</span>
                  <span>{opt.label}</span>
                  <span className="text-xs text-gray-600 font-normal">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 氛围描述输入 */}
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

          {/* 聊天记录输入 */}
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

          {/* 主持人对话界面 */}
          {topicMode === "ai_host" && (
            <div className="bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
                <span className="text-sm font-medium text-indigo-400">🎙 AI 主持人</span>
                {hostDone && (
                  <span className="ml-auto text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                    ✓ 背景收集完成
                  </span>
                )}
              </div>

              {/* 对话消息 */}
              <div className="px-4 py-3 space-y-3 max-h-64 overflow-y-auto">
                {!hostStarted && (
                  <p className="text-gray-500 text-sm text-center animate-pulse">主持人准备中...</p>
                )}
                {hostMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-800 text-gray-200"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {hostLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-800 rounded-2xl px-3 py-2 text-sm text-gray-500 animate-pulse">
                      ···
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* 输入框 */}
              {!hostDone && (
                <div className="px-3 pb-3 flex gap-2">
                  <input
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
                    placeholder="回复主持人..."
                    value={hostInput}
                    onChange={(e) => setHostInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendHostMessage()}
                    disabled={hostLoading}
                    maxLength={200}
                  />
                  <button
                    onClick={sendHostMessage}
                    disabled={hostLoading || !hostInput.trim()}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium transition"
                  >
                    发送
                  </button>
                </div>
              )}

              {/* 提取到的信息展示 */}
              {hostDone && extractedInfo?.moodHint && (
                <div className="px-4 pb-3">
                  <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-3 py-2 text-xs text-indigo-300 space-y-0.5">
                    <p>氛围：{extractedInfo.moodHint}</p>
                    {extractedInfo.keywords.length > 0 && (
                      <p>关键词：{extractedInfo.keywords.join(" / ")}</p>
                    )}
                  </div>
                </div>
              )}

              {hostDone && (
                <div className="px-4 pb-3 text-center">
                  <p className="text-xs text-gray-500">主持人已了解背景，点击下方按钮开始</p>
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          <button
            onClick={handleCreate}
            disabled={loading || !canCreate}
            className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-white transition text-lg mt-2"
          >
            {loading
              ? topicMode === "default"
                ? "创建中..."
                : "AI 生成主题中..."
              : topicMode === "ai_host" && !hostDone
              ? "等待主持人对话完成..."
              : "创建抽签局"}
          </button>
        </div>
      </div>
    </main>
  );
}
