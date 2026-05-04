import { NextRequest, NextResponse } from "next/server";

const MUSIC_TOOL_SERVER = process.env.MUSIC_TOOL_SERVER_URL || "http://localhost:8001";

export interface SongResult {
  id: number;
  name: string;
  artist: string;
  album: string;
  duration: number;
  url: string;
  cover?: string;
}

/**
 * 搜索歌曲接口
 * 代理转发到 Python Music Tool Server
 * GET /api/music/search?q=夜车+李志&limit=5
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  const limit = req.nextUrl.searchParams.get("limit") || "5";

  if (!q?.trim()) {
    return NextResponse.json({ songs: [], total: 0, query: "" });
  }

  try {
    const res = await fetch(
      `${MUSIC_TOOL_SERVER}/search?q=${encodeURIComponent(q.trim())}&limit=${limit}`,
      { next: { revalidate: 60 } } // 缓存 60 秒
    );

    if (!res.ok) {
      return NextResponse.json({ songs: [], total: 0, query: q, error: "搜索服务暂时不可用" });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    // 降级：返回空结果，不影响用户手动输入
    return NextResponse.json({ songs: [], total: 0, query: q, error: "搜索服务不可用" });
  }
}
