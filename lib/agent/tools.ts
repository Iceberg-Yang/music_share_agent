import { tool } from "@langchain/core/tools";
import { z } from "zod";

const MUSIC_TOOL_SERVER = process.env.MUSIC_TOOL_SERVER_URL || "http://localhost:8001";

export interface VerifyResult {
  exists: boolean;
  confidence: number;
  song?: {
    id: number;
    name: string;
    artist: string;
    album: string;
    url: string;
    cover?: string;
  };
  message: string;
}

/**
 * LangGraph Tool：在网易云音乐验证歌曲是否真实存在
 *
 * 供 generateSummaryNode 在 ReAct 模式下调用：
 * AI 推荐一首歌后，必须用此工具验证歌曲存在，才能输出最终结果。
 * 若验证失败，AI 需要换一首歌重新推荐并再次验证。
 */
export const searchNeteaseTool = tool(
  async ({ songName, artist }) => {
    try {
      const res = await fetch(`${MUSIC_TOOL_SERVER}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songName, artist }),
        signal: AbortSignal.timeout(10000), // 10s 超时
      });

      if (!res.ok) {
        return {
          exists: false,
          confidence: 0,
          message: "验证服务暂时不可用",
        } satisfies VerifyResult;
      }

      const data: VerifyResult = await res.json();
      return data;
    } catch {
      return {
        exists: false,
        confidence: 0,
        message: "验证服务连接超时，请换一首知名度更高的歌曲",
      } satisfies VerifyResult;
    }
  },
  {
    name: "search_netease_music",
    description:
      "在网易云音乐验证歌曲是否真实存在，并返回播放链接和专辑封面。" +
      "推荐歌曲前必须调用此工具验证。若返回 exists=false，需换一首歌重新推荐并再次验证。",
    schema: z.object({
      songName: z.string().describe("歌曲名称，例如：夜车"),
      artist: z.string().describe("歌手名称，例如：李志"),
    }),
  }
);
