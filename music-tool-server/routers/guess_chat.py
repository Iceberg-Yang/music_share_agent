"""
/guess-chat/* 路由

由 Next.js API Routes 在验证身份后转发过来，
本服务只负责运行 GuessChatGraph，不做业务权限校验。
"""

import traceback
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from langgraph.types import Command

from agent.guess_graph import get_compiled_graph, build_guess_graph, _default_state

router = APIRouter(prefix="/guess-chat", tags=["guess-chat"])


# ──────────────────────────────────────────────
# Pydantic 模型
# ──────────────────────────────────────────────

class StartRequest(BaseModel):
    thread_id: str       # "{inviteCode}_guess_{participantId}"
    song_name: str       # 对方的歌名
    artist: str          # 歌手
    topic: str           # 正确答案（由 Next.js 从数据库取后传入）
    max_attempts: int = 3


class GuessRequest(BaseModel):
    thread_id: str
    guess: str           # 玩家输入的猜测词


class RevealRequest(BaseModel):
    thread_id: str


# ──────────────────────────────────────────────
# 工具函数：从图状态提取当前快照
# ──────────────────────────────────────────────

def _extract_response(state: dict, thread_id: str) -> dict:
    """把图当前 state 转换为 API 响应格式"""
    messages = state.get("messages", [])
    last_assistant = next(
        (m["content"] for m in reversed(messages) if m["role"] == "assistant"),
        "",
    )
    return {
        "thread_id": thread_id,
        "reply": last_assistant,
        "verdict": state.get("verdict", "pending"),
        "attempts": state.get("attempts", 0),
        "max_attempts": state.get("max_attempts", 3),
        "resolved": state.get("resolved", False),
        "answer": state.get("topic") if state.get("resolved") else None,
        "final_reveal": state.get("final_reveal"),
        "messages": messages,
    }


# ──────────────────────────────────────────────
# POST /guess-chat/start
# 初始化图，运行到第一个 interrupt（judge_and_hint 生成开场线索后）
# ──────────────────────────────────────────────

_graph_instance = None


async def _get_graph():
    """获取编译好的图（全局单例，确保 MemorySaver 跨请求共享）"""
    global _graph_instance
    if _graph_instance is not None:
        return _graph_instance

    try:
        _graph_instance = await get_compiled_graph()
        print("[info] 使用 PostgresSaver")
    except Exception as e:
        print(f"[warn] PostgresSaver 不可用（{e}），使用 MemorySaver 降级（仅本地开发）")
        from langgraph.checkpoint.memory import MemorySaver
        _graph_instance = build_guess_graph().compile(checkpointer=MemorySaver())

    return _graph_instance


@router.post("/start")
async def start_guess(req: StartRequest):
    try:
        graph = await _get_graph()
        config = {"configurable": {"thread_id": req.thread_id}}

        initial_state = {
            **_default_state(),
            "song_name": req.song_name,
            "artist": req.artist,
            "topic": req.topic,
            "max_attempts": req.max_attempts,
        }

        result = await graph.ainvoke(initial_state, config)
        return _extract_response(result, req.thread_id)

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"启动猜谜图失败: {str(e)}")


# ──────────────────────────────────────────────
# POST /guess-chat/guess
# resume 图，注入用户猜测，运行到下一个 interrupt 或 END
# ──────────────────────────────────────────────

@router.post("/guess")
async def submit_guess(req: GuessRequest):
    try:
        graph = await _get_graph()
        config = {"configurable": {"thread_id": req.thread_id}}

        result = await graph.ainvoke(
            Command(resume={"guess": req.guess}),
            config,
        )
        return _extract_response(result, req.thread_id)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"提交猜测失败: {str(e)}")


# ──────────────────────────────────────────────
# POST /guess-chat/reveal
# 强制揭晓：绕过剩余 interrupt，直接跳到 reveal_node
# 实现方式：传入一个特殊的 "give_up" 猜测，让条件路由强制走揭晓
# ──────────────────────────────────────────────

@router.post("/reveal")
async def force_reveal(req: RevealRequest):
    try:
        graph = await _get_graph()
        config = {"configurable": {"thread_id": req.thread_id}}

        # 检查当前图状态
        snapshot = await graph.aget_state(config)
        if not snapshot or not snapshot.values:
            raise HTTPException(status_code=404, detail="猜谜会话不存在")

        current = snapshot.values
        current_attempts = current.get("attempts", 0)
        max_attempts = current.get("max_attempts", 3)

        # 如果已经结束，直接返回现有状态
        if current.get("resolved"):
            return _extract_response(current, req.thread_id)

        # 强制设置 attempts 到上限，让条件路由走 reveal 分支
        # 通过提交一个特殊猜测（__give_up__），在 judge 节点里不会真正判断
        # 而是因为 attempts >= max_attempts 触发强制揭晓
        force_attempts = max_attempts  # 确保超出上限

        # 更新 state 中的 attempts 到上限，然后 resume
        result = await graph.ainvoke(
            Command(
                resume={"guess": "__give_up__"},
                update={"attempts": force_attempts},
            ),
            config,
        )
        return _extract_response(result, req.thread_id)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"强制揭晓失败: {str(e)}")
