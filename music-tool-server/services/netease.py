"""
网易云音乐 API 封装

优先使用 pyncm（纯 Python SDK，直接对接网易云）。
若 pyncm 未安装，自动回退到直接 HTTP 调用方式。
"""

from typing import Optional

try:
    import pyncm  # noqa: F401
    _USE_PYNCM = True
except ImportError:
    _USE_PYNCM = False

if _USE_PYNCM:
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    from pyncm.apis import cloudsearch, track as pyncm_track

    _executor = ThreadPoolExecutor(max_workers=4)

    def _search_sync(keyword: str, limit: int) -> list[dict]:
        try:
            result = cloudsearch.GetSearchResult(keyword, limit=limit, type_=1)
            songs = result.get("result", {}).get("songs", [])
            return songs if isinstance(songs, list) else []
        except Exception:
            return []

    def _detail_sync(song_id: int) -> Optional[dict]:
        try:
            result = pyncm_track.GetTrackDetail([song_id])
            songs = result.get("songs", [])
            return songs[0] if songs else None
        except Exception:
            return None

    async def search_songs(keyword: str, limit: int = 5) -> list[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_executor, _search_sync, keyword, limit)

    async def get_song_detail(song_id: int) -> Optional[dict]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_executor, _detail_sync, song_id)

else:
    # 回退：直接 HTTP（无需任何额外依赖）
    import httpx

    _HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": "https://music.163.com",
    }
    _SEARCH_URL = "https://music.163.com/api/search/get"
    _TIMEOUT = 10.0

    async def search_songs(keyword: str, limit: int = 5) -> list[dict]:  # type: ignore[misc]
        async with httpx.AsyncClient(headers=_HEADERS, follow_redirects=True) as client:
            try:
                resp = await client.get(
                    _SEARCH_URL,
                    params={"s": keyword, "type": 1, "offset": 0,
                            "limit": limit, "total": "true"},
                    timeout=_TIMEOUT,
                )
                resp.raise_for_status()
                return resp.json().get("result", {}).get("songs") or []
            except Exception:
                return []

    async def get_song_detail(song_id: int) -> Optional[dict]:  # type: ignore[misc]
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
    """格式化歌曲，兼容 pyncm 和直接 HTTP 两种返回格式"""
    song_id = raw.get("id", 0)

    artists = raw.get("artists") or raw.get("ar") or []
    artist_name = "、".join(a.get("name", "") for a in artists if a.get("name"))

    album = raw.get("album") or raw.get("al") or {}
    album_name = album.get("name", "")

    # 封面 URL（两种格式都尝试）
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
