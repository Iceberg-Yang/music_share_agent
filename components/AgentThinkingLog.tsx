"use client";

import { useEffect, useRef, useState } from "react";

interface LogEntry {
  node: string;
  startAt: string;
  endAt?: string;
  durationMs?: number;
  type: "llm" | "tool" | "human" | "route";
  summary: string;
  detail?: string;
}

interface Props {
  roomId: string;
  phase: string;
}

const TYPE_ICON: Record<string, string> = {
  llm: "🧠",
  tool: "🔧",
  human: "👤",
  route: "📍",
};

const TYPE_COLOR: Record<string, string> = {
  llm: "text-purple-400 border-purple-800",
  tool: "text-amber-400 border-amber-800",
  human: "text-blue-400 border-blue-800",
  route: "text-gray-400 border-gray-700",
};

function nodeLabel(name: string): string {
  const map: Record<string, string> = {
    loadMemoryNode: "加载历史记忆",
    analyzeChatNode: "分析聊天内容",
    generateTopicsNode: "生成抽签主题",
    waitForDrawsNode: "等待双方抽签",
    waitForEntriesNode: "等待双方选歌",
    generateSummaryNode: "生成音乐总结",
    updateMemoryNode: "更新记忆档案",
  };
  return map[name] ?? name;
}

export default function AgentThinkingLog({ roomId, phase }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isActive = !["completed", "expired", "done"].includes(phase);

  useEffect(() => {
    fetchLogs();
    if (isActive) {
      intervalRef.current = setInterval(fetchLogs, 3000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [roomId, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (expanded) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, expanded]);

  async function fetchLogs() {
    try {
      const res = await fetch(`/api/rooms/${roomId}?fields=executionLog`);
      if (!res.ok) return;
      const data = await res.json();
      const rawLog: string | null = data.agentExecutionLog;
      if (rawLog) {
        const parsed: LogEntry[] = JSON.parse(rawLog);
        setLogs(parsed);
      }
    } catch {
      // 静默失败
    }
  }

  if (logs.length === 0) return null;

  return (
    <div className="mt-6 bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition"
      >
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <span>🤖</span>
          <span>Agent 工作日志</span>
          <span className="text-xs bg-gray-800 text-gray-500 rounded-full px-2 py-0.5">
            {logs.length} 步
          </span>
          {isActive && (
            <span className="flex items-center gap-1 text-xs text-indigo-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              运行中
            </span>
          )}
        </div>
        <span className="text-gray-600 text-xs">{expanded ? "▲ 收起" : "▼ 展开"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2 max-h-72 overflow-y-auto">
          {logs.map((log, idx) => (
            <div
              key={idx}
              className={`flex gap-3 p-2.5 rounded-xl border bg-gray-950 text-xs ${TYPE_COLOR[log.type] ?? "text-gray-400 border-gray-700"}`}
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <span className="text-base shrink-0 mt-0.5">
                {TYPE_ICON[log.type] ?? "▸"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-medium">{nodeLabel(log.node)}</span>
                  {log.durationMs != null && (
                    <span className="text-gray-600 text-[10px]">
                      {log.durationMs < 1000
                        ? `${log.durationMs}ms`
                        : `${(log.durationMs / 1000).toFixed(1)}s`}
                    </span>
                  )}
                </div>
                <p className="text-gray-400 leading-relaxed">{log.summary}</p>
                {log.detail && (
                  <p className="text-gray-600 mt-1 leading-relaxed truncate">{log.detail}</p>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
