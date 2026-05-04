"use client";

import { useState } from "react";

interface ChatMessage {
  role: "assistant" | "user";
  content: string;
}

interface GuessChatState {
  thread_id: string;
  reply: string;
  verdict: "pending" | "correct" | "close" | "wrong";
  attempts: number;
  max_attempts: number;
  resolved: boolean;
  answer: string | null;
  final_reveal: string | null;
  messages: ChatMessage[];
}

interface Props {
  roomId: string;
  participantId: string;
  sessionToken: string;
  opponentNickname: string;
  onComplete?: () => void;
}

export default function GuessChatWidget({
  roomId,
  participantId,
  sessionToken,
  opponentNickname,
  onComplete,
}: Props) {
  const [phase, setPhase] = useState<"idle" | "chatting" | "done">("idle");
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [state, setState] = useState<GuessChatState | null>(null);

  async function startChat() {
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/guess-chat/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, sessionToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "启动失败");
      setState(data);
      setPhase("chatting");
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "启动失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function submitGuess() {
    if (!input.trim() || !state || loading) return;
    const guess = input.trim();
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/guess-chat/guess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, sessionToken, guess }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败");
      setState(data);
      if (data.resolved) {
        setPhase("done");
        onComplete?.();
      }
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "提交失败");
    } finally {
      setLoading(false);
    }
  }

  async function giveUp() {
    if (!state || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${roomId}/guess-chat/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, sessionToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "请求失败");
      setState(data);
      setPhase("done");
      onComplete?.();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "揭晓失败");
    } finally {
      setLoading(false);
    }
  }

  // ── 初始状态 ──────────────────────────────────
  if (phase === "idle") {
    return (
      <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
        <p className="text-sm text-gray-400 mb-1">猜一猜 🎯</p>
        <p className="text-xs text-gray-500 mb-4">
          AI 会根据 {opponentNickname} 选的歌给你线索，猜出对方抽到的主题！
        </p>
        <button
          onClick={startChat}
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium transition"
        >
          {loading ? "AI 准备中…" : "开始猜谜 →"}
        </button>
      </div>
    );
  }

  // ── 揭晓状态 ──────────────────────────────────
  if (phase === "done" && state) {
    const isCorrect = state.verdict === "correct";
    return (
      <div
        className={`rounded-2xl p-5 border ${
          isCorrect
            ? "bg-green-950/40 border-green-800"
            : "bg-gray-900 border-gray-700"
        }`}
      >
        {/* 对话历史 */}
        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {state.messages.map((m, i) => (
            <MessageBubble key={i} msg={m} />
          ))}
        </div>

        {/* 揭晓卡片 */}
        <div className="text-center pt-3 border-t border-gray-700">
          <div className="text-3xl mb-2">{isCorrect ? "🎉" : "😅"}</div>
          <p className="font-semibold mb-1">
            {isCorrect ? "猜对了！" : "揭晓答案"}
          </p>
          <p className="text-sm text-gray-400">
            {opponentNickname} 的主题是{" "}
            <span className="text-indigo-300 font-medium">
              「{state.answer}」
            </span>
          </p>
          {state.final_reveal && (
            <p className="text-xs text-gray-500 mt-2 italic">
              {state.final_reveal}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── 猜谜对话中 ────────────────────────────────
  if (!state) return null;

  const remainingAttempts = state.max_attempts - state.attempts;

  return (
    <div className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
      {/* header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-400">猜一猜 🎯</p>
        <span className="text-xs text-gray-600">
          还剩 {remainingAttempts} 次机会
        </span>
      </div>

      {/* 对话记录 */}
      <div className="space-y-2 mb-4 max-h-48 overflow-y-auto pr-1">
        {state.messages.map((m, i) => (
          <MessageBubble key={i} msg={m} />
        ))}
        {loading && (
          <div className="text-left">
            <span className="inline-block bg-gray-700 text-gray-300 text-sm rounded-2xl rounded-tl-none px-3 py-2">
              AI 思考中…
            </span>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="flex gap-2">
        <input
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
          placeholder="输入猜测词…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitGuess()}
          maxLength={20}
          disabled={loading}
        />
        <button
          onClick={submitGuess}
          disabled={loading || !input.trim()}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium transition"
        >
          猜
        </button>
      </div>

      {/* 放弃 */}
      <button
        onClick={giveUp}
        disabled={loading}
        className="mt-2 w-full text-xs text-gray-600 hover:text-gray-400 transition py-1"
      >
        我不知道，直接揭晓
      </button>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isAI = msg.role === "assistant";
  return (
    <div className={`flex ${isAI ? "justify-start" : "justify-end"}`}>
      <span
        className={`inline-block text-sm rounded-2xl px-3 py-2 max-w-[85%] break-words ${
          isAI
            ? "bg-gray-700 text-gray-200 rounded-tl-none"
            : "bg-indigo-700 text-white rounded-tr-none"
        }`}
      >
        {msg.content}
      </span>
    </div>
  );
}
