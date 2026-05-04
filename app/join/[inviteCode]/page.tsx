"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { saveSession, getSession } from "@/lib/utils";
import { getUserId } from "@/lib/memory/userIdentity";

export default function JoinPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const router = useRouter();
  const [roomName, setRoomName] = useState("");
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // 检查房间是否存在，以及当前是否已有身份
    fetch(`/api/rooms/${inviteCode}`)
      .then((res) => {
        if (!res.ok) { router.push("/"); return null; }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        setRoomName(data.name);

        const session = getSession(data.id);
        if (session) {
          const found = data.participants.find((p: { id: string }) => p.id === session.participantId);
          if (found) {
            router.push(`/room/${inviteCode}`);
            return;
          }
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [inviteCode, router]);

  async function handleJoin() {
    setError("");
    if (!nickname.trim()) return setError("请输入昵称");
    setLoading(true);
    try {
      const res = await fetch(`/api/rooms/${inviteCode}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname, userId: getUserId() }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error || "加入失败");
      saveSession(data.roomId, data.participantId, data.sessionToken);
      router.push(`/room/${inviteCode}`);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500 animate-pulse">加载中...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="text-4xl mb-4">🎵</div>
          <p className="text-gray-400 text-sm mb-1">你被邀请加入</p>
          <h1 className="text-2xl font-bold">{roomName}</h1>
        </div>

        <div className="bg-gray-900 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">你的昵称</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition"
              placeholder="叫什么都行"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              autoFocus
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            onClick={handleJoin}
            disabled={loading}
            className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 font-semibold transition text-lg"
          >
            {loading ? "加入中..." : "加入抽签局"}
          </button>
        </div>

        <p className="text-center text-xs text-gray-600">
          抽签后你需要分享一首和主题有关的歌
        </p>
      </div>
    </main>
  );
}
