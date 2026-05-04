from fastapi import APIRouter, Query, HTTPException
from services.netease import search_songs, format_song
from models import SearchResponse, SongResult

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=SearchResponse)
async def search_music(
    q: str = Query(..., min_length=1, description="搜索关键词，例如：夜车 李志"),
    limit: int = Query(5, ge=1, le=10, description="返回结果数量"),
):
    """
    搜索网易云音乐歌曲

    供前端输入框联想搜索使用。
    """
    if not q.strip():
        raise HTTPException(status_code=400, detail="搜索词不能为空")

    raw_songs = await search_songs(q.strip(), limit)

    songs = []
    for raw in raw_songs:
        formatted = format_song(raw)
        songs.append(SongResult(**formatted))

    return SearchResponse(songs=songs, total=len(songs), query=q)
