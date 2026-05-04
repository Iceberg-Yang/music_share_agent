from pydantic import BaseModel, Field
from typing import Optional, List


class SongResult(BaseModel):
    id: int
    name: str
    artist: str
    album: str
    duration: int = 0           # 毫秒
    url: str                    # 网易云页面链接
    cover: Optional[str] = None # 专辑封面 URL


class SearchResponse(BaseModel):
    songs: List[SongResult]
    total: int
    query: str


class VerifyRequest(BaseModel):
    songName: str = Field(..., description="歌曲名称")
    artist: str = Field(..., description="歌手名称")


class VerifyResponse(BaseModel):
    exists: bool
    song: Optional[SongResult] = None
    confidence: float = Field(0.0, ge=0.0, le=1.0, description="匹配置信度 0-1")
    message: str = ""
