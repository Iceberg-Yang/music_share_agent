from fastapi import APIRouter
from services.netease import search_songs, format_song
from services.matcher import find_best_match
from models import VerifyRequest, VerifyResponse, SongResult

router = APIRouter(prefix="/verify", tags=["verify"])


@router.post("", response_model=VerifyResponse)
async def verify_song(body: VerifyRequest):
    """
    验证歌曲是否真实存在（核心接口，供 LangGraph Tool 调用）

    流程：
    1. 用"歌名 歌手"作为关键词搜索网易云
    2. 用 rapidfuzz 对搜索结果做模糊匹配
    3. 返回匹配置信度和真实歌曲信息（含播放页 URL 和封面）
    """
    query = f"{body.songName} {body.artist}"
    raw_songs = await search_songs(query, limit=5)

    if not raw_songs:
        return VerifyResponse(
            exists=False,
            confidence=0.0,
            message="网易云搜索无结果，可能网络异常或歌曲不在库中",
        )

    # 格式化候选列表
    candidates = [format_song(raw) for raw in raw_songs]

    # 模糊匹配
    best, confidence = find_best_match(
        query_name=body.songName,
        query_artist=body.artist,
        candidates=candidates,
    )

    if best is None:
        return VerifyResponse(
            exists=False,
            confidence=round(confidence, 3),
            message=f"置信度 {confidence:.0%}，未达到阈值，歌曲可能不存在或名称有误",
        )

    song = SongResult(**best)
    return VerifyResponse(
        exists=True,
        song=song,
        confidence=round(confidence, 3),
        message=f"匹配成功，置信度 {confidence:.0%}",
    )
