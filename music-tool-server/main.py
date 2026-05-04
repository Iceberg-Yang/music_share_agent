"""
Music Tool Server
双人音乐抽签 Agent 的 Python 工具层

提供网易云音乐的歌曲搜索和验证接口
供 LangGraph Agent（TypeScript）通过 HTTP 调用
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import search, verify

app = FastAPI(
    title="Music Tool Server",
    description="网易云音乐工具服务，供 LangGraph Agent 调用。提供歌曲搜索、验证等能力。",
    version="1.0.0",
    docs_url="/docs",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(verify.router)


@app.get("/health", tags=["meta"])
async def health():
    """健康检查，供 Railway / Render 监控使用"""
    return {"status": "ok", "service": "music-tool-server", "version": "1.0.0"}


@app.get("/", tags=["meta"])
async def root():
    return {
        "service": "Music Tool Server",
        "endpoints": {
            "搜索歌曲": "GET /search?q=歌名+歌手&limit=5",
            "验证歌曲": "POST /verify  body: {songName, artist}",
            "API 文档": "/docs",
        },
    }
