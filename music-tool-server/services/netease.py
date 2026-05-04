"""
网易云音乐 API 封装
依赖 NeteaseCloudMusicApi（开源 Node.js 项目）作为代理层
GitHub: https://github.com/Binaryify/NeteaseCloudMusicApi
"""

import os
import httpx
from typing import Optional

# NeteaseCloudMusicApi 的部署地址，通过环境变量配置
NETEASE_API_BASE = os.getenv(
    "NETEASE_API_BASE",
    "https://netease-cloud-music-api-five-tau.vercel.app",  # 公共 demo 实例（不稳定，建议自部署）
)

TIMEOUT = 12.0  # 秒


async def search_songs(keyword: str, limit: int = 5) -> list[dict]:
    """搜索歌曲，返回原始结果列表"""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                f"{NETEASE_API_BASE}/search",
                params={"keywords": keyword, "limit": limit, "type": 1},
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("result", {}).get("songs", [])
        except (httpx.TimeoutException, httpx.HTTPError, KeyError, ValueError):
            return []


async def get_song_detail(song_id: int) -> Optional[dict]:
    """获取歌曲详情（含专辑封面）"""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                f"{NETEASE_API_BASE}/song/detail",
                params={"ids": song_id},
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            songs = data.get("songs", [])
            return songs[0] if songs else None
        except (httpx.TimeoutException, httpx.HTTPError, KeyError, ValueError):
            return None


def format_song(raw: dict) -> dict:
    """把 NeteaseCloudMusicApi 返回的原始歌曲对象格式化为统一结构"""
    song_id = raw.get("id", 0)

    # 歌手（可能有多个）
    artists = raw.get("artists") or raw.get("ar") or []
    artist_name = "、".join(a.get("name", "") for a in artists) if artists else ""

    # 专辑
    album = raw.get("album") or raw.get("al") or {}
    album_name = album.get("name", "")
    cover_url = album.get("picUrl") or album.get("pic_str")

    return {
        "id": song_id,
        "name": raw.get("name", ""),
        "artist": artist_name,
        "album": album_name,
        "duration": raw.get("duration") or raw.get("dt") or 0,
        "url": f"https://music.163.com/#/song?id={song_id}",
        "cover": cover_url,
    }
