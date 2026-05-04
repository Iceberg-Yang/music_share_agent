"""
备用方案：直接调用网易云搜索接口（无需 Node.js 代理，无需 pyncm）

使用网易云的旧版 web 搜索 API，配合必要的请求头伪装浏览器。
此端点目前无需 cookie 即可搜索，适合生产环境降级使用。

若主方案（pyncm）失败，将 services/netease.py 替换为此文件内容即可。
"""

import httpx
from typing import Optional

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Referer": "https://music.163.com",
    "Origin": "https://music.163.com",
}

TIMEOUT = 10.0
SEARCH_URL = "https://music.163.com/api/search/get"


async def search_songs(keyword: str, limit: int = 5) -> list[dict]:
    """搜索歌曲"""
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        try:
            resp = await client.get(
                SEARCH_URL,
                params={
                    "s": keyword,
                    "type": 1,
                    "offset": 0,
                    "limit": limit,
                    "total": "true",
                },
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("result", {}).get("songs") or []
        except Exception:
            return []


async def get_song_detail(song_id: int) -> Optional[dict]:
    """获取歌曲详情（含封面）"""
    async with httpx.AsyncClient(headers=HEADERS) as client:
        try:
            resp = await client.get(
                "https://music.163.com/api/song/detail",
                params={"ids": f"[{song_id}]"},
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            songs = resp.json().get("songs", [])
            return songs[0] if songs else None
        except Exception:
            return None


def format_song(raw: dict) -> dict:
    """格式化歌曲信息（兼容搜索结果和详情接口的字段差异）"""
    song_id = raw.get("id", 0)

    artists = raw.get("artists") or raw.get("ar") or []
    artist_name = "、".join(a.get("name", "") for a in artists if a.get("name"))

    album = raw.get("album") or raw.get("al") or {}
    album_name = album.get("name", "")

    cover: Optional[str] = None
    pic_id = album.get("picId") or album.get("pic")
    if pic_id:
        cover = f"https://p1.music.126.net/{pic_id}/{pic_id}.jpg"
    if not cover:
        cover = album.get("picUrl") or album.get("blurPicUrl")

    return {
        "id": song_id,
        "name": raw.get("name", ""),
        "artist": artist_name,
        "album": album_name,
        "duration": raw.get("duration") or raw.get("dt") or 0,
        "url": f"https://music.163.com/#/song?id={song_id}",
        "cover": cover,
    }
