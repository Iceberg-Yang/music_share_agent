"""
Music Tool Server
双人音乐抽签 Agent 的 Python 工具层

提供网易云音乐的歌曲搜索和验证接口
供 LangGraph Agent（TypeScript）通过 HTTP 调用
"""

from dotenv import load_dotenv
load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import search, verify
from routers import guess_chat


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # 关闭时清理数据库连接池
    from agent.checkpointer import close_checkpointer
    await close_checkpointer()


app = FastAPI(
    title="Music Tool Server",
    description="网易云音乐工具服务 + Python LangGraph 猜谜 Agent。",
    version="2.0.0",
    docs_url="/docs",
    lifespan=lifespan,
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
app.include_router(guess_chat.router)


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
            "猜谜开始": "POST /guess-chat/start",
            "提交猜测": "POST /guess-chat/guess",
            "强制揭晓": "POST /guess-chat/reveal",
            "API 文档": "/docs",
        },
    }
