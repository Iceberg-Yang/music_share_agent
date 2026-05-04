"""
GuessChatGraph — Python LangGraph 猜谜对话图

图结构：
  START
    ↓
  judge_and_hint_node   ← 开场生成线索 / 有猜测时：裁判 + 提示
    ↓
  ── 条件路由 ──────────────────────────────────────────
    correct                           → reveal_node
    close/wrong, attempts < max       → wait_for_guess_node（循环）
    close/wrong, attempts >= max      → reveal_node（强制揭晓）
  ──────────────────────────────────────────────────────
    ↓
  wait_for_guess_node   ← interrupt()，等待用户输入
    ↓（resume 后回到 judge_and_hint_node）
  reveal_node           ← 生成揭晓文案
    ↓
  END

thread_id 命名约定：{inviteCode}_guess_{participantId}
"""

import json
import os
from typing import Literal, Any
from typing_extensions import TypedDict

from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command

from .prompts import (
    JUDGE_SYSTEM,
    OPENING_USER,
    GUESS_USER,
    REVEAL_CORRECT_SYSTEM,
    REVEAL_FAILED_SYSTEM,
)


# ──────────────────────────────────────────────
# State
# ──────────────────────────────────────────────

class Message(TypedDict):
    role: str    # "assistant" | "user"
    content: str


class GuessState(TypedDict):
    # 输入（游戏开始时注入，全程不变）
    song_name: str
    artist: str
    topic: str           # 正确答案（AI 知道，用户不知道）
    max_attempts: int    # 默认 3

    # 对话状态
    messages: list[Message]
    attempts: int        # 已猜次数（0 = 还没猜过）
    user_guess: str | None

    # AI 裁判结果
    verdict: Literal["correct", "close", "wrong", "pending"]

    # 终态
    resolved: bool
    final_reveal: str | None


def _default_state() -> GuessState:
    return GuessState(
        song_name="",
        artist="",
        topic="",
        max_attempts=3,
        messages=[],
        attempts=0,
        user_guess=None,
        verdict="pending",
        resolved=False,
        final_reveal=None,
    )


# ──────────────────────────────────────────────
# LLM
# ──────────────────────────────────────────────

def _resolve_api_key() -> str | None:
    """Railway / 本地常见坑：变量名不一致、值带引号、首尾空格。"""
    raw = (os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY") or "").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        raw = raw[1:-1].strip()
    return raw or None


def _get_llm() -> ChatOpenAI:
    kwargs: dict = {
        "model": os.getenv("LLM_MODEL", "deepseek-v4-flash"),
        "base_url": os.getenv("LLM_BASE_URL", "https://api.deepseek.com"),
        "temperature": 0.7,
    }
    key = _resolve_api_key()
    if key:
        kwargs["api_key"] = key
    # 不传 api_key 时 ChatOpenAI 会读环境变量 OPENAI_API_KEY
    return ChatOpenAI(**kwargs)


# ──────────────────────────────────────────────
# 节点：judge_and_hint_node
# ──────────────────────────────────────────────

async def judge_and_hint_node(state: GuessState) -> dict[str, Any]:
    llm = _get_llm()

    system_prompt = JUDGE_SYSTEM.format(
        song_name=state["song_name"],
        artist=state["artist"],
        topic=state["topic"],
    )

    is_opening = state["attempts"] == 0

    if is_opening:
        user_content = OPENING_USER.format(
            song_name=state["song_name"],
            artist=state["artist"],
        )
    else:
        remaining = state["max_attempts"] - state["attempts"]
        user_content = GUESS_USER.format(
            user_guess=state["user_guess"] or "",
            attempts=state["attempts"],
            remaining=max(0, remaining),
        )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    # 强制 JSON 输出
    response = await llm.ainvoke(
        messages,
        response_format={"type": "json_object"},
    )

    try:
        parsed = json.loads(response.content)
        verdict = parsed.get("verdict", "wrong")
        reply = parsed.get("reply", "")
    except (json.JSONDecodeError, AttributeError):
        verdict = "wrong"
        reply = "嗯，再想想看？"

    # 开场时 verdict 固定 pending
    if is_opening:
        verdict = "pending"

    new_message: Message = {"role": "assistant", "content": reply}

    return {
        "verdict": verdict,
        "messages": state["messages"] + [new_message],
        "user_guess": None,  # 清空，等下一轮输入
    }


# ──────────────────────────────────────────────
# 节点：wait_for_guess_node
# ──────────────────────────────────────────────

async def wait_for_guess_node(state: GuessState) -> dict[str, Any]:
    # interrupt() 使图暂停，等待 resume 注入数据
    user_input: dict = interrupt({
        "waiting_for": "user_guess",
        "attempts": state["attempts"],
        "max_attempts": state["max_attempts"],
    })

    guess = user_input.get("guess", "")
    user_message: Message = {"role": "user", "content": guess}

    return {
        "user_guess": guess,
        "attempts": state["attempts"] + 1,
        "messages": state["messages"] + [user_message],
    }


# ──────────────────────────────────────────────
# 节点：reveal_node
# ──────────────────────────────────────────────

async def reveal_node(state: GuessState) -> dict[str, Any]:
    llm = _get_llm()

    correct = state["verdict"] == "correct"

    # 提取猜测历史
    user_msgs = [m["content"] for m in state["messages"] if m["role"] == "user"]
    last_guess = user_msgs[-1] if user_msgs else ""
    guess_history = "、".join(f"「{g}」" for g in user_msgs) if user_msgs else "没有猜测"

    if correct:
        prompt = REVEAL_CORRECT_SYSTEM.format(
            topic=state["topic"],
            song_name=state["song_name"],
            artist=state["artist"],
            guess_history=guess_history,
        )
    else:
        prompt = REVEAL_FAILED_SYSTEM.format(
            topic=state["topic"],
            song_name=state["song_name"],
            artist=state["artist"],
            last_guess=last_guess or "未知",
        )

    response = await llm.ainvoke([{"role": "user", "content": prompt}])
    reveal_text = response.content.strip()

    reveal_message: Message = {"role": "assistant", "content": reveal_text}

    return {
        "resolved": True,
        "final_reveal": reveal_text,
        "messages": state["messages"] + [reveal_message],
    }


# ──────────────────────────────────────────────
# 条件路由
# ──────────────────────────────────────────────

def route_after_judge(state: GuessState) -> str:
    # 开场（pending）→ 先让用户猜
    if state["verdict"] == "pending":
        return "wait_for_guess"

    # 猜对了 → 揭晓
    if state["verdict"] == "correct":
        return "reveal"

    # 超出次数 → 强制揭晓
    if state["attempts"] >= state["max_attempts"]:
        return "reveal"

    # 还有机会 → 继续猜
    return "wait_for_guess"


# ──────────────────────────────────────────────
# 图构建
# ──────────────────────────────────────────────

def build_guess_graph():
    graph = StateGraph(GuessState)

    graph.add_node("judge_and_hint", judge_and_hint_node)
    graph.add_node("wait_for_guess", wait_for_guess_node)
    graph.add_node("reveal", reveal_node)

    graph.add_edge(START, "judge_and_hint")
    graph.add_conditional_edges(
        "judge_and_hint",
        route_after_judge,
        {
            "wait_for_guess": "wait_for_guess",
            "reveal": "reveal",
        },
    )
    graph.add_edge("wait_for_guess", "judge_and_hint")
    graph.add_edge("reveal", END)

    return graph


async def get_compiled_graph():
    from .checkpointer import get_checkpointer
    checkpointer = await get_checkpointer()
    return build_guess_graph().compile(checkpointer=checkpointer)
