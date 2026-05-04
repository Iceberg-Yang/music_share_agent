"""
网易云音乐 API 封装（httpx 直接调用）
"""

import httpx
from typing import Optional

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://music.163.com",
}
_TIMEOUT = 10.0


async def search_songs(keyword: str, limit: int = 5) -> list[dict]:
    async with httpx.AsyncClient(headers=_HEADERS, follow_redirects=True) as client:
        try:
            resp = await client.get(
                "https://music.163.com/api/search/get",
                params={"s": keyword, "type": 1, "offset": 0,
                        "limit": limit, "total": "true"},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            return resp.json().get("result", {}).get("songs") or []
        except Exception:
            return []


async def get_song_detail(song_id: int) -> Optional[dict]:
    async with httpx.AsyncClient(headers=_HEADERS) as client:
        try:
            resp = await client.get(
                "https://music.163.com/api/song/detail",
                params={"ids": f"[{song_id}]"},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            songs = resp.json().get("songs", [])
            return songs[0] if songs else None
        except Exception:
            return None


def format_song(raw: dict) -> dict:
    song_id = raw.get("id", 0)

    artists = raw.get("artists") or raw.get("ar") or []
    artist_name = "、".join(a.get("name", "") for a in artists if a.get("name"))

    album = raw.get("album") or raw.get("al") or {}
    album_name = album.get("name", "")

    cover: Optional[str] = album.get("picUrl") or album.get("blurPicUrl")
    if not cover:
        pic_id = album.get("picId") or album.get("pic")
        if pic_id:
            cover = f"https://p1.music.126.net/{pic_id}/{pic_id}.jpg"

    return {
        "id": song_id,
        "name": raw.get("name", ""),
        "artist": artist_name,
        "album": album_name,
        "duration": raw.get("duration") or raw.get("dt") or 0,
        "url": f"https://music.163.com/#/song?id={song_id}",
        "cover": cover,
    }
