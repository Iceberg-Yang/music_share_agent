import { NextRequest, NextResponse } from "next/server";
import { getUserMemory } from "@/lib/memory/crud";

/** GET /api/memory/user?userId=u_xxx */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId?.startsWith("u_")) {
    return NextResponse.json({ gamesPlayed: 0 });
  }

  try {
    const mem = await getUserMemory(userId);
    if (!mem) return NextResponse.json({ gamesPlayed: 0 });

    return NextResponse.json({
      gamesPlayed: mem.gamesPlayed,
      nickname: mem.nickname,
      lastSong: mem.lastSong,
      lastArtist: mem.lastArtist,
      styles: mem.musicDNA?.styles?.slice(0, 3) ?? [],
    });
  } catch {
    return NextResponse.json({ gamesPlayed: 0 });
  }
}
