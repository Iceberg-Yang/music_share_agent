# 双人音乐抽签 Agent V4 技术规划

> **核心目标**：让 Agent 从"一次性工具"升级为"认识你的陪伴者"。
> 通过记忆系统、思考过程可视化、AI 引导猜谜、结果反馈，让两个人在同一个 Agent 的见证下积累共同的音乐历史。

---

## 1. V3 现状与 V4 目标

### V3 已有

- **TypeScript LangGraph**：完整主游戏图，真正 Human-in-the-loop（interrupt/resume）
- **Tool Use + ReAct**：searchNeteaseTool 验证推荐歌曲
- **PostgreSQL Checkpointer**：PostgresSaver 跨 Serverless 状态持久化
- **Python FastAPI 微服务**（`music-tool-server`）：网易云搜索 + rapidfuzz 模糊匹配
- 前端歌曲搜索联想框、Agent 执行日志展示

### V4 新增五项能力

| 能力 | 核心价值 | 技术方向 | 状态 |
|------|---------|---------|------|
| A. 记忆系统 | Agent 认识你，积累音乐历史 | UserMemory + PairMemory + TS LangGraph 新节点 | ✅ 已实现 |
| B. Agent 思考直播 | 等待时共同观看 AI 工作过程 | 轮询执行日志 + 逐条动画 | ✅ 已实现 |
| C. AI 引导猜谜 | 多轮对话 + AI 主持 + 语义裁判 | **Python LangGraph（GuessChatGraph）** | 🔜 本阶段目标 |
| D. 结果页留言 | 对 AI 总结给出反应 | GameReaction 表 + 投票 UI | ✅ 已实现 |
| E. 首页欢迎回来 | 有历史感的开场 | 读取 UserMemory | ✅ 已实现 |

---

## 2. 整体架构（方案 C）

### 核心架构原则

> **TypeScript 负责主游戏，Python 负责猜谜 Agent。**
> 两张 LangGraph 图语言不同，但共享同一个 PostgreSQL Checkpointer（底层 `checkpoints` 表格式兼容）。
> Next.js 既调 TypeScript 图（直接调用），也调 Python 图（通过 HTTP 转发）。

```
┌──────────────────────────────────────────────────────────────────┐
│                    Next.js Frontend (Vercel)                     │
│  首页  →  房间页  →  抽签  →  提交歌曲  →  结果页               │
│                                          ↕                      │
│                                     猜谜对话 UI                  │
└────────────┬──────────────────────────────┬──────────────────────┘
             │ Next.js API Routes            │ Next.js API Routes
             │                              │（/api/guess-chat/*）
             ↓                              ↓ 转发到 Python
┌────────────────────────┐    ┌─────────────────────────────────────┐
│  MainGameGraph         │    │  music-tool-server (Railway · Python)│
│  TypeScript LangGraph  │    │                                     │
│                        │    │  ┌─────────────────────────────┐    │
│  loadMemory            │    │  │  GuessChatGraph             │    │
│  analyzeChat           │    │  │  Python LangGraph           │    │
│  generateTopics        │    │  │                             │    │
│  ← interrupt → draw    │    │  │  judge_and_hint_node        │    │
│  ← interrupt → entries │    │  │  ← interrupt → wait_guess  │    │
│  generateSummary       │    │  │  (循环 ≤ 3 次)              │    │
│  updateMemory          │    │  │  reveal_node                │    │
│                        │    │  └─────────────────────────────┘    │
│  thread: inviteCode    │    │                                     │
└────────────┬───────────┘    │  /search  /verify  （已有工具）     │
             │                │  /guess-chat/start                  │
             │                │  /guess-chat/guess                  │
             │                │  /guess-chat/reveal                 │
             ↓                └──────────────────┬──────────────────┘
┌────────────────────────────────────────────────┴──────────────────┐
│                  PostgreSQL · Neon                                 │
│  两张图共用同一个数据库，PostgresSaver 底层表格式跨语言兼容        │
│  thread: inviteCode              ← 主游戏图                       │
│  thread: inviteCode_guess_A      ← A 的猜谜对话                   │
│  thread: inviteCode_guess_B      ← B 的猜谜对话（并行互不干扰）    │
└───────────────────────────────────────────────────────────────────┘
```

---

## 3. 功能 A/B/D/E（已实现，设计回顾）

### A. 记忆系统

- **用户识别**：`localStorage` 存 `u_xxx` 设备 ID，无需注册
- **双人配对**：两个 userId 排序拼接生成 `pairId`，A+B 恒等于 B+A
- **LoadMemory**：主游戏图起点，加载 `UserMemory` + `PairMemory`，构建文字摘要注入后续节点 prompt
- **UpdateMemory**：主游戏图终点，异步写入（不阻塞用户看结果）
- **数据表**：`UserMemory`（音乐 DNA + 历史主题）、`PairMemory`（共同游戏快照 + 关系标签）

### B. Agent 思考直播

- 前端 3s 轮询 `agentExecutionLog`，逐条追加到日志面板
- 每条记录节点名、类型（llm/tool/human/route）、耗时
- 猜谜图的执行日志也会追加进来，完整展示两张图的工作轨迹

### D/E. 留言 + 欢迎回来

- `GameReaction` 表存 `accuracyVote`（准/接近/没准）+ 最多 100 字留言
- 首页读取 `UserMemory` 展示欢迎横幅 + 自动回填昵称

---

## 4. 功能 C：AI 引导猜谜（本阶段核心）

### 4.1 游戏流程

```
双方提交歌曲，进入结果页
        ↓
[我的卡片：主题 + 歌曲 完整展示]
[对方卡片：只看到歌曲，主题隐藏 → "猜对后揭晓"]
        ↓
┌─────────────────────────────────────┐
│  「猜一猜」区域（GuessChatGraph 驱动）│
│                                     │
│  AI 开场线索                         │
│    ↓ 用户猜                          │
│  AI 裁判 + 新提示（最多 3 轮）         │
│    ↓ correct 或超次数                │
│  AI 揭晓文案                         │
└─────────────────────────────────────┘
        ↓
对方主题揭晓，卡片显示完整信息
        ↓
AI 总结 + 留言 + Agent 日志
```

### 4.2 GuessChatGraph（Python LangGraph）

#### State 定义

```python
class GuessState(TypedDict):
    # ── 输入（游戏开始时注入，全程不变）
    song_name: str          # 对方的歌
    artist: str             # 歌手
    topic: str              # 正确答案（AI 知道，用户不知道）
    max_attempts: int       # 最大猜测次数，默认 3

    # ── 对话状态
    messages: list[dict]    # 完整对话历史，追加模式
    attempts: int           # 已猜次数（0 = 还没猜过）
    user_guess: str | None  # 当前轮用户的猜测词

    # ── 裁判结果
    verdict: Literal["correct", "close", "wrong", "pending"]

    # ── 终态
    resolved: bool
    final_reveal: str | None   # 揭晓文案
```

#### 图结构

```
START
  ↓
judge_and_hint_node    ← 开场（attempts=0）生成第一条线索
                         有猜测时：LLM 一次调用完成裁判 + 生成提示
  ↓
─── 条件路由 ──────────────────────────────────────────────
  verdict=correct                       → reveal_node
  verdict=close/wrong, attempts<max     → wait_for_guess_node（循环）
  verdict=close/wrong, attempts>=max    → reveal_node（强制揭晓）
────────────────────────────────────────────────────────────
  ↓
wait_for_guess_node    ← interrupt()，暂停等待用户输入
  ↓（resume 后）
judge_and_hint_node    ← 循环回裁判节点
  ↓
reveal_node            ← 生成揭晓文案
  ↓
END
```

#### judge_and_hint_node 设计（核心节点）

**一次 LLM 调用完成两件事**：裁判当前猜测 + 生成下一条提示（或揭晓前文案）

```
System Prompt：
  你是音乐猜谜主持人，知道正确答案是「{topic}」。
  玩家要根据歌曲《{song_name}》-{artist} 猜主题。
  
  [判断标准]
  - correct：猜测词与答案语义相同、包含，或是答案的核心意象
  - close：相关但不够准（给方向提示）
  - wrong：方向完全偏了（给新角度提示）
  
  [输出格式] 严格 JSON：
  {
    "verdict": "correct|close|wrong",
    "reply": "给用户看的回复（不超过50字，有温度感）"
  }
  
  开场时（attempts=0）verdict 固定为 "pending"，reply 为第一条线索。

开场时的 User Prompt：
  请根据《{song_name}》-{artist} 生成第一条隐晦线索（不说主题词）

猜测时的 User Prompt：
  用户猜了「{user_guess}」，这是第 {attempts} 次猜测，还剩 {remaining} 次机会。
  请判断并生成回复。
```

**关键设计**：开场和猜测合用同一节点，通过 `attempts==0` 区分，避免节点分裂。

#### wait_for_guess_node 设计

```python
def wait_for_guess_node(state: GuessState):
    # interrupt() 使图暂停，等待 resume 注入数据
    user_input = interrupt({"attempts": state["attempts"], "max_attempts": state["max_attempts"]})
    
    return {
        "user_guess": user_input["guess"],
        "attempts": state["attempts"] + 1,
        "messages": [{"role": "user", "content": user_input["guess"]}]
    }
```

#### reveal_node 设计

两种情况，各有文案风格：

```
猜对时：
  "就是这个！「{topic}」✨
   你从《{song_name}》里读出了这种感觉"

超次数时（未猜对）：
  "答案是「{topic}」—— 
   也许{topic}和你猜的{last_guess}，本来就是同一首歌里的不同面。"
   （最后一句由 LLM 即兴生成，连接两个主题）
```

#### PostgresSaver 接入方式

```python
# music-tool-server/agent/checkpointer.py

from langgraph.checkpoint.postgres import PostgresSaver
import psycopg

_checkpointer = None

def get_checkpointer():
    global _checkpointer
    if _checkpointer is None:
        conn = psycopg.connect(os.getenv("DATABASE_URL"))
        _checkpointer = PostgresSaver(conn)
        _checkpointer.setup()   # 幂等，建表不重复
    return _checkpointer
```

> 与 TypeScript 的 `@langchain/langgraph-checkpoint-postgres` 使用同一张 `checkpoints` 表，但因为 thread_id 完全不同，互不干扰。

### 4.3 FastAPI 路由设计

```
music-tool-server 新增三个端点：

POST /guess-chat/start
  Input:  { invite_code, participant_id, song_name, artist, topic }
  Action: 初始化 GuessChatGraph，thread_id = f"{invite_code}_guess_{participant_id}"
          运行到第一个 interrupt（即 judge_and_hint_node 生成开场线索后）
  Output: { thread_id, first_hint: str }

POST /guess-chat/guess
  Input:  { thread_id, guess: str }
  Action: resume 图，注入 { "guess": guess }
          图运行到下一个 interrupt 或 END
  Output: {
    reply: str,          AI 回复（提示或庆祝）
    verdict: str,        correct / close / wrong
    attempts: int,       已猜次数
    resolved: bool,      是否结束
    answer: str | None,  resolved=true 时揭晓
    final_reveal: str | None
  }

POST /guess-chat/reveal
  Input:  { thread_id }
  Action: 强制结束，绕过 interrupt 直接运行到 reveal_node → END
  Output: { answer: str, final_reveal: str }
```

### 4.4 Next.js API 转发层

Next.js 不直接跑 Python 图，只做**认证 + 转发**：

```
Next.js API Routes（新增）：

POST /api/rooms/[roomId]/guess-chat/start
  → 验证 participantId + sessionToken
  → 从数据库取对方的 songName / artist / topic
  → 转发到 Python: POST {MUSIC_TOOL_SERVER}/guess-chat/start
  → 返回 firstHint 给前端

POST /api/rooms/[roomId]/guess-chat/guess
  → 验证身份
  → 转发到 Python: POST {MUSIC_TOOL_SERVER}/guess-chat/guess
  → 如果 resolved=true，把 guessCorrect 写入 Participant 表
  → 返回结果给前端

POST /api/rooms/[roomId]/guess-chat/reveal
  → 验证身份
  → 转发到 Python
  → 写入 Participant.guessCorrect = false
  → 返回答案
```

### 4.5 前端 UI 设计

**猜谜区（替换现有简单输入框）**

```
┌──────────────────────────────────────────┐
│  猜一猜 🎯                               │
│  对方选了《追光者》- 岑宁儿               │
│  ──────────────────────────────────────  │
│  ┌──────────────────────────────────┐   │
│  │ 🤖 这首歌里有很强的都市感，       │   │  ← AI 气泡
│  │    副歌出现了一种追逐的意象...     │   │
│  └──────────────────────────────────┘   │
│                                          │
│  你：「夜晚」                            │  ← 用户历史
│                                          │
│  ┌──────────────────────────────────┐   │
│  │ 🤖 方向偏了，想想更具象的场景...  │   │  ← AI 气泡
│  └──────────────────────────────────┘   │
│                                          │
│  ┌─────────────────────┐  [提交]        │
│  │ 输入你的猜测...      │               │
│  └─────────────────────┘               │
│  第 2 次 / 共 3 次      [直接看答案]    │
└──────────────────────────────────────────┘
```

**猜测结果揭晓**

```
┌──────────────────────────────────────┐
│  🎉 就是这个！                       │  ← 猜对
│  答案是「城市」                      │
│  你从第二条提示里读出了那种          │
│  都市追逐的感觉                      │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│  😊 答案是「城市」                   │  ← 超次数
│  也许夜晚和城市，                    │
│  本来就是同一条路上的两面。          │
└──────────────────────────────────────┘
```

**AgentThinkingLog 中展示猜谜轨迹**

```
🧠 生成开场线索           llm   820ms
👤 等待猜测 #1            human  ——
🧠 裁判 + 提示 #1         llm   680ms   verdict: wrong
👤 等待猜测 #2            human  ——
🧠 裁判 + 揭晓文案        llm   710ms   verdict: correct
```

---

## 5. music-tool-server 文件结构变更

```
music-tool-server/
├── main.py                      ← 新增 guess-chat router
├── requirements.txt             ← 新增 langgraph, langchain-openai, langgraph-checkpoint-postgres
│
├── agent/                       ← 新增目录
│   ├── __init__.py
│   ├── checkpointer.py          ← PostgresSaver 单例
│   ├── guess_graph.py           ← GuessChatGraph 图定义
│   └── prompts.py               ← Prompt 模板
│
├── routers/
│   ├── search.py                ← 已有
│   ├── verify.py                ← 已有
│   └── guess_chat.py            ← 新增：/guess-chat/* 端点
│
└── services/
    ├── netease.py               ← 已有
    └── matcher.py               ← 已有
```

### requirements.txt 新增

```
langgraph>=0.2.0
langgraph-checkpoint-postgres>=2.0.0
langchain-openai>=0.2.0
psycopg[binary]>=3.1.0
```

---

## 6. 实现顺序（下阶段）

```
✅ Phase 1-5（已完成）：记忆 / 思考直播 / 基础互猜 / 留言 / AI分离

────────── 下阶段 ──────────

Phase 6：Python GuessChatGraph 核心
  目标：在 music-tool-server 里跑通整个猜谜图
  步骤：
    1. 安装新依赖（langgraph, langchain-openai, psycopg）
    2. agent/checkpointer.py：Python PostgresSaver 单例
    3. agent/guess_graph.py：
       - GuessState TypedDict 定义
       - judge_and_hint_node（LLM 一次调用）
       - wait_for_guess_node（interrupt）
       - reveal_node
       - 条件路由函数
       - 图编译 + checkpointer 接入
    4. routers/guess_chat.py：
       - POST /guess-chat/start
       - POST /guess-chat/guess
       - POST /guess-chat/reveal
    5. main.py 注册新 router
    6. 本地用 curl 测试完整 3 轮对话

Phase 7：Next.js API 转发层
  步骤：
    1. app/api/rooms/[roomId]/guess-chat/start/route.ts
    2. app/api/rooms/[roomId]/guess-chat/guess/route.ts
    3. app/api/rooms/[roomId]/guess-chat/reveal/route.ts
       （含身份验证 + 转发 + 写入 Participant.guessCorrect）
    4. 删除旧的简单 guess API（/api/rooms/[roomId]/guess）

Phase 8：前端猜谜对话 UI
  步骤：
    1. 新建 components/GuessChatWidget.tsx
       - 消息气泡列表（AI/用户区分）
       - 输入框 + 提交
       - 次数显示 + 放弃按钮
       - 揭晓动画
    2. 替换 room 页面中的简单猜测输入框
    3. start API 在进入 result 阶段时自动调用（懒初始化）
    4. 猜谜结束后触发对方卡片主题揭晓动画

Phase 9：Railway 部署 + 端到端验证
  步骤：
    1. push music-tool-server，Railway 重新部署
    2. 线上测试完整猜谜流程（3 轮 + 放弃 + 猜对）
    3. 验证 PostgresSaver thread 不与主游戏图冲突
    4. 验证 AgentThinkingLog 中猜谜日志是否正确追加
```

---

## 7. 技术风险与对策

| 风险 | 描述 | 对策 |
|------|------|------|
| LLM 输出不稳定 | judge_and_hint_node 要求严格 JSON | 用 `with_structured_output` 或 `response_format=json_object` 强制结构化 |
| Python PostgresSaver 版本兼容 | Python 和 TS 两个 checkpointer 写同一个库 | 两边都用最新版，底层表 schema 相同，thread 隔离即可 |
| music-tool-server 冷启动 | Railway 休眠后首次请求慢 | 前端进入结果页时提前 ping，或 Railway 配置 always-on |
| 猜谜图的 thread 孤儿 | 玩家中途离开，thread 永远停在 interrupt | 无需清理（不影响功能），或加 TTL 定期清理 checkpoints 表 |
| 中文 LLM 判断不稳定 | 某些近义主题被误判 | 在 prompt 里加例子（few-shot），或把 verdict 枚举精确到 5 档 |

---

## 8. 完整系统简历叙事（V4 完成后）

> **具备长期记忆与多轮交互的双人音乐 Agent**
>
> 系统包含两张独立 LangGraph：
> - **MainGameGraph（TypeScript）**：管理完整游戏生命周期，含记忆加载/写入节点、LLM 主题生成与总结、Tool Use 验证推荐歌曲，通过 PostgresSaver 实现 Serverless 跨请求状态持久化。
> - **GuessChatGraph（Python）**：独立猜谜 Agent，带条件循环的多轮对话图。AI 同时扮演主持人（生成隐晦线索）和裁判（LLM 语义判断正确性），通过 interrupt/resume 实现 Human-in-the-loop，最多 3 轮后强制揭晓并生成诗意连接文案。
>
> 两张图共享同一个 PostgreSQL Checkpointer，thread 隔离，互不干扰。Python FastAPI 微服务（Railway）同时承担工具层（网易云搜索/验证）和猜谜 Agent，TypeScript 层（Vercel）负责主游戏与身份验证。
>
> Agent 覆盖五大能力：**感知**（聊天分析）、**记忆**（跨局 UserMemory/PairMemory）、**规划**（条件路由/循环图）、**行动**（Tool Use / HITL）、**反思**（裁判节点语义判断 + 动态提示生成）。
>
> **技术栈**：Next.js · TypeScript LangGraph · Python LangGraph · PostgreSQL (Neon) · Python FastAPI (Railway) · DeepSeek LLM
