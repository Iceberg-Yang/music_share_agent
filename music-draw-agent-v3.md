# 双人音乐抽签 Agent V3 技术规划

> 核心目标：补齐 V2 的两个关键短板（真正的 Human-in-the-loop + Tool Use），同时引入 Python 微服务作为音乐工具层，形成一个 TypeScript orchestration + Python tool server 的双语言 Agent 架构。

---

## 1. V2 现状与 V3 目标

### V2 已有

- LangGraph 分析子图（analyzeChatNode → generateTopicsNode）
- LangGraph 总结子图（generateSummaryNode + 下一首推荐）
- 多轮对话主持人 Agent
- 双人性格分析与关系标签
- Agent 执行日志展示

### V2 存在的问题

**问题 1：Human-in-the-loop 是"假的"**

V2 的等待抽签/提交是靠数据库状态机实现的，LangGraph 并不真正参与挂起和恢复。面试官如果深问"你的 interrupt 机制怎么工作的"，无法给出有说服力的回答。

**问题 2：没有 Tool Use**

三个 LLM 节点都是纯文本输入输出，没有调用任何工具。"下一首推荐"推荐了什么歌，Agent 自己都不知道歌是否真实存在。这是 Agent 能力缺失的体现。

**问题 3：没有 Python**

整个项目是纯 TypeScript，对于 Agent 开发岗，Python 是主流语言，面试可能被质疑。

### V3 新增三项能力

| 能力 | 技术实现 | 语言 |
|---|---|---|
| A. 真正的 Human-in-the-loop | PostgreSQL Checkpointer + interrupt/resume | TypeScript |
| B. Tool Use + ReAct 推荐验证 | LangGraph bindTools + searchNeteaseTool | TypeScript + Python |
| C. Python 音乐工具服务 | FastAPI 微服务，提供歌曲搜索/验证接口 | Python |

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  前端（Next.js / TypeScript）                                │
│  - 歌曲搜索联想框                                            │
│  - 结果页：网易云链接 + 专辑封面                              │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────────────────────────────┐
│  Next.js API Routes（TypeScript）                            │
│  - LangGraph 工作流编排                                       │
│  - PostgreSQL Checkpointer（真正的 interrupt/resume）         │
│  - 调用 Python Music Tool Server                             │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP / MCP
┌──────────────▼──────────────────────────────────────────────┐
│  Python Music Tool Server（FastAPI）  ← V3 新增              │
│  - /search    搜索网易云歌曲                                  │
│  - /verify    验证歌曲是否存在并返回详情                       │
│  - /playlist  获取/添加歌单（需用户登录）                     │
│  部署在 Railway / Render                                     │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────────────────────────────┐
│  NeteaseCloudMusicApi（Node.js，已有开源实现）                │
│  部署在 Vercel，作为网易云的非官方 API 代理                    │
└─────────────────────────────────────────────────────────────┘
```

### 为什么要 Python 微服务而不是直接在 TypeScript 里调用网易云

1. **展示双语言 Agent 架构**：生产级 Agent 系统通常是 orchestration 和 tool server 分离，orchestration 用 TypeScript/Python，tool server 可以是任意语言。Python 微服务就是这种 tool server 的典型实现。

2. **Python 生态更丰富**：`fuzzywuzzy`（歌曲名模糊匹配）、`jieba`（中文分词）、`pydantic`（数据校验）在 Python 里更自然。

3. **简历叙事**：可以说"Agent 的 tool server 用 Python FastAPI 实现，通过 HTTP 接口供 TypeScript orchestration 调用"，这比"全栈 TypeScript"在 Agent 岗更有说服力。

---

## 3. 能力 A：真正的 Human-in-the-loop

### 现在（V2）

```
创建房间 → LangGraph 跑完分析 → 手动把 state JSON 存数据库
抽签 → 更新数据库 participant 字段，LangGraph 不知道
提交音乐 → 检测到两人都提交 → 手动调用 LangGraph 总结图
```

LangGraph 只在开头和结尾参与，中间的"等待"阶段完全是我们自己的状态机。

### V3 目标

```
创建房间 → LangGraph 执行到 waitForDraw → interrupt() 挂起
          → PostgreSQL Checkpointer 自动保存完整 state

用户抽签 → API 调用 graph.invoke(Command({ resume: drawData }))
          → LangGraph 从 checkpoint 恢复，处理抽签数据
          → 检测到两人都抽完 → 继续推进到 waitForEntries → interrupt() 再次挂起

用户提交 → API 调用 graph.invoke(Command({ resume: entryData }))
          → LangGraph 从 checkpoint 恢复
          → 检测到两人都提交 → 推进到 generateSummaryNode（含 Tool Use）→ END
```

### 技术实现

**安装 PostgreSQL Checkpointer**

```bash
npm install @langchain/langgraph-checkpoint-postgres
```

**初始化 Checkpointer**

```typescript
// lib/agent/checkpointer.ts
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres"

let _checkpointer: PostgresSaver | null = null

export function getCheckpointer() {
  if (!_checkpointer) {
    _checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL!)
  }
  return _checkpointer
}
```

**完整工作流（一个大图，含 interrupt 节点）**

```typescript
// lib/agent/graph.ts - V3 版本

import { StateGraph, START, END, interrupt, Command } from "@langchain/langgraph"

export function buildFullGraph() {
  return new StateGraph(MusicDrawAnnotation)
    .addNode("analyzeChatNode", analyzeChatNode)
    .addNode("generateTopicsNode", generateTopicsNode)
    .addNode("waitForDrawNode", waitForDrawNode)      // interrupt 节点
    .addNode("waitForEntriesNode", waitForEntriesNode) // interrupt 节点
    .addNode("generateSummaryNode", generateSummaryWithToolsNode) // ReAct 节点
    .addEdge(START, "analyzeChatNode")
    .addEdge("analyzeChatNode", "generateTopicsNode")
    .addEdge("generateTopicsNode", "waitForDrawNode")
    .addConditionalEdges("waitForDrawNode", routeAfterDraw, {
      "waitForEntriesNode": "waitForEntriesNode",
      "waitForDrawNode": "waitForDrawNode", // 继续等待
    })
    .addConditionalEdges("waitForEntriesNode", routeAfterEntries, {
      "generateSummaryNode": "generateSummaryNode",
      "waitForEntriesNode": "waitForEntriesNode", // 继续等待
    })
    .addEdge("generateSummaryNode", END)
    .compile({ checkpointer: getCheckpointer() })
}
```

**waitForDraw 节点实现（真正的 interrupt）**

```typescript
async function waitForDrawNode(state: typeof MusicDrawAnnotation.State) {
  const allDrawn = state.participants.every(p => p.drawnTopic)
  
  if (!allDrawn) {
    // 真正的 LangGraph interrupt，工作流在此挂起
    const drawData = interrupt({
      message: "等待参与者抽签",
      waitingFor: state.participants.filter(p => !p.drawnTopic).map(p => p.id)
    })
    
    // resume 后，drawData 包含新的抽签数据
    return {
      participants: state.participants.map(p =>
        p.id === drawData.participantId
          ? { ...p, drawnTopic: drawData.topic }
          : p
      )
    }
  }
  
  return {} // 两人都抽完，推进到下一节点
}
```

**API Route 调用方式**

```typescript
// 创建房间 - 启动工作流
const graph = buildFullGraph()
await graph.invoke(initialState, {
  configurable: { thread_id: roomId }
})
// 此时 graph 在 waitForDraw interrupt 挂起，state 自动保存到 PostgreSQL

// 抽签 - 恢复工作流
await graph.invoke(
  new Command({ resume: { participantId, topic: drawnTopic } }),
  { configurable: { thread_id: roomId } }
)
// graph 从 checkpoint 恢复，处理数据，再次在 waitForDraw 或 waitForEntries 挂起
```

**Thread ID 策略**

使用 `roomId` 作为 `thread_id`，每个房间对应一个独立的 LangGraph workflow 线程。Checkpointer 自动管理该线程的 checkpoint 历史。

**Checkpoint 数据库表**

LangGraph PostgreSQL Checkpointer 会自动在数据库中创建以下表：

```sql
checkpoints         -- 每个 checkpoint 的元数据
checkpoint_blobs    -- state 数据（二进制序列化）
checkpoint_writes   -- 每次节点执行的写入记录
```

这三张表完全由 LangGraph 管理，我们不需要手动操作。可以删除 V2 的 `agentState` 字段（因为 Checkpointer 接管了 state 持久化）。

---

## 4. 能力 B：Tool Use + ReAct 推荐验证

### 工作流程

```
generateSummaryNode（ReAct 模式）：

Round 1：
  LLM 思考 → 决定推荐《夜车》- 李志
  LLM 调用 tool: search_netease({ songName: "夜车", artist: "李志" })
  工具返回: { exists: true, id: "123456", url: "https://music.163.com/#/song?id=123456" }

Round 2：
  LLM 收到工具结果 → 确认歌曲存在
  LLM 输出最终结果（含真实 URL）

如果 Round 1 工具返回 exists: false：
  LLM 换一首歌重新推荐，继续调用工具验证
  最多重试 2 次，仍失败则不附 URL
```

### LangGraph 绑定工具

```typescript
// lib/agent/nodes.ts - generateSummaryNode V3 版本

import { ChatOpenAI } from "@langchain/openai"
import { searchNeteaseTool } from "./tools"

export async function generateSummaryWithToolsNode(
  state: typeof MusicDrawAnnotation.State
) {
  const llm = new ChatOpenAI({
    model: process.env.LLM_MODEL!,
    apiKey: process.env.LLM_API_KEY!,
    configuration: { baseURL: process.env.LLM_BASE_URL! },
  })

  // 绑定工具，模型可以主动调用
  const llmWithTools = llm.bindTools([searchNeteaseTool])

  const systemPrompt = `你是一个音乐局的旁观者和策展人。
生成总结后，你必须调用 search_netease 工具验证你推荐的歌曲是否真实存在。
如果工具返回 exists: false，换一首歌并重新验证。`

  // 创建 ReAct Agent Executor（带工具调用循环）
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: buildSummaryPrompt(state) }
  ]

  let result = await llmWithTools.invoke(messages)
  
  // 处理工具调用循环（最多 3 轮）
  let rounds = 0
  while (result.tool_calls?.length && rounds < 3) {
    rounds++
    const toolResults = await Promise.all(
      result.tool_calls.map(tc => searchNeteaseTool.invoke(tc))
    )
    messages.push(result, ...toolResults)
    result = await llmWithTools.invoke(messages)
  }

  return parseSummaryResult(result.content as string)
}
```

---

## 5. 能力 C：Python 音乐工具服务

### 为什么用 Python

- Python 的 `httpx`、`pydantic`、`fastapi` 组合是构建 HTTP 工具服务的标准栈
- 网易云 API 的结果需要做中文模糊匹配（`rapidfuzz` 库），Python 生态更成熟
- 展示双语言能力：TypeScript 做 orchestration，Python 做 tool server

### 项目结构

```
music-tool-server/           ← 新建，独立仓库或子目录
├── main.py                  ← FastAPI 入口
├── routers/
│   ├── search.py            ← 搜索接口
│   ├── verify.py            ← 验证接口
│   └── playlist.py          ← 歌单接口（可选）
├── services/
│   ├── netease.py           ← 网易云 API 封装
│   └── matcher.py           ← 歌曲名模糊匹配
├── models.py                ← Pydantic 数据模型
├── requirements.txt
└── README.md
```

### 核心代码示例

**models.py**

```python
from pydantic import BaseModel
from typing import Optional, List

class SongResult(BaseModel):
    id: int
    name: str
    artist: str
    album: str
    duration: int           # 毫秒
    url: str                # 网易云页面链接
    cover: Optional[str]    # 专辑封面 URL

class SearchResponse(BaseModel):
    songs: List[SongResult]
    total: int

class VerifyResponse(BaseModel):
    exists: bool
    song: Optional[SongResult]
    confidence: float       # 匹配置信度 0-1
```

**services/netease.py**

```python
import httpx
from typing import Optional
from models import SongResult

NETEASE_API_BASE = "https://your-netease-api.vercel.app"

async def search_songs(keyword: str, limit: int = 5) -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{NETEASE_API_BASE}/search",
            params={"keywords": keyword, "limit": limit},
            timeout=10.0
        )
        data = resp.json()
        return data.get("result", {}).get("songs", [])

async def get_song_detail(song_id: int) -> Optional[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{NETEASE_API_BASE}/song/detail",
            params={"ids": song_id},
            timeout=10.0
        )
        data = resp.json()
        songs = data.get("songs", [])
        return songs[0] if songs else None
```

**services/matcher.py**

```python
from rapidfuzz import fuzz

def match_song(
    query_name: str,
    query_artist: str,
    candidates: list[dict]
) -> tuple[dict | None, float]:
    """
    对搜索结果做模糊匹配，返回最佳匹配和置信度
    解决"夜车"搜到"午夜的夜车"的误匹配问题
    """
    if not candidates:
        return None, 0.0

    best_match = None
    best_score = 0.0

    for song in candidates:
        name_score = fuzz.ratio(query_name, song.get("name", "")) / 100
        artists = [a.get("name", "") for a in song.get("artists", [])]
        artist_score = max(
            (fuzz.ratio(query_artist, a) / 100 for a in artists),
            default=0
        )
        # 歌名权重 0.7，歌手权重 0.3
        total_score = name_score * 0.7 + artist_score * 0.3

        if total_score > best_score:
            best_score = total_score
            best_match = song

    return best_match, best_score

def is_confident_match(score: float, threshold: float = 0.65) -> bool:
    return score >= threshold
```

**routers/search.py**

```python
from fastapi import APIRouter, Query
from services.netease import search_songs
from models import SearchResponse, SongResult

router = APIRouter(prefix="/search", tags=["search"])

@router.get("", response_model=SearchResponse)
async def search_music(
    q: str = Query(..., description="搜索关键词，格式：歌名 歌手"),
    limit: int = Query(5, ge=1, le=10)
):
    raw_songs = await search_songs(q, limit)
    songs = [
        SongResult(
            id=s["id"],
            name=s["name"],
            artist=s["artists"][0]["name"] if s.get("artists") else "",
            album=s.get("album", {}).get("name", ""),
            duration=s.get("duration", 0),
            url=f"https://music.163.com/#/song?id={s['id']}",
            cover=s.get("album", {}).get("picUrl")
        )
        for s in raw_songs
    ]
    return SearchResponse(songs=songs, total=len(songs))
```

**routers/verify.py**

```python
from fastapi import APIRouter
from pydantic import BaseModel
from services.netease import search_songs
from services.matcher import match_song, is_confident_match
from models import VerifyResponse, SongResult

router = APIRouter(prefix="/verify", tags=["verify"])

class VerifyRequest(BaseModel):
    songName: str
    artist: str

@router.post("", response_model=VerifyResponse)
async def verify_song(body: VerifyRequest):
    """
    验证歌曲是否真实存在（供 LangGraph Tool 调用）
    """
    query = f"{body.songName} {body.artist}"
    candidates = await search_songs(query, limit=5)
    match, score = match_song(body.songName, body.artist, candidates)

    if not is_confident_match(score):
        return VerifyResponse(exists=False, song=None, confidence=score)

    song = SongResult(
        id=match["id"],
        name=match["name"],
        artist=match["artists"][0]["name"] if match.get("artists") else "",
        album=match.get("album", {}).get("name", ""),
        duration=match.get("duration", 0),
        url=f"https://music.163.com/#/song?id={match['id']}",
        cover=match.get("album", {}).get("picUrl")
    )
    return VerifyResponse(exists=True, song=song, confidence=score)
```

**main.py**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import search, verify, playlist

app = FastAPI(
    title="Music Tool Server",
    description="网易云音乐工具服务，供 LangGraph Agent 调用",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router)
app.include_router(verify.router)
app.include_router(playlist.router)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "music-tool-server"}
```

**requirements.txt**

```
fastapi==0.115.0
uvicorn==0.30.0
httpx==0.27.0
pydantic==2.8.0
rapidfuzz==3.9.0
python-dotenv==1.0.0
```

### 部署方式

```bash
# Railway（推荐，免费额度够用）
railway login
railway init
railway up

# 或者 Render（同样免费）
# 连接 GitHub 仓库，选择 Python + uvicorn
```

部署后得到 `https://music-tool-server.railway.app`，在 Next.js 的 `.env` 里配置：

```
MUSIC_TOOL_SERVER_URL=https://music-tool-server.railway.app
```

---

## 6. TypeScript Tool 封装（连接 Python 服务）

```typescript
// lib/agent/tools.ts
import { tool } from "@langchain/core/tools"
import { z } from "zod"

const MUSIC_SERVER = process.env.MUSIC_TOOL_SERVER_URL!

export const searchNeteaseTool = tool(
  async ({ songName, artist }) => {
    const res = await fetch(`${MUSIC_SERVER}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songName, artist }),
    })
    const data = await res.json()
    return {
      exists: data.exists,
      confidence: data.confidence,
      song: data.song,
      url: data.song?.url || null,
      confirmedName: data.song?.name || songName,
      confirmedArtist: data.song?.artist || artist,
    }
  },
  {
    name: "search_netease_music",
    description: "在网易云音乐验证歌曲是否真实存在，并返回播放链接和专辑封面。推荐歌曲前必须调用此工具验证。",
    schema: z.object({
      songName: z.string().describe("歌曲名称"),
      artist: z.string().describe("歌手名称"),
    }),
  }
)
```

---

## 7. 前端改动

### 7.1 提交音乐时的搜索联想

在提交音乐表单的歌名输入框，增加联想搜索（调用 Python Tool Server）：

```
用户输入：夜车
↓ 防抖 300ms 后调用 /api/music/search?q=夜车
↓ 返回：
  ○ 《夜车》- 李志          | 4:12 | [选择]
  ○ 《夜车》- 张宇          | 3:45 | [选择]
  ○ 《午夜的夜车》- 万能青年  | 5:08 | [选择]

点击选择后：
  - 歌名自动填入
  - 歌手自动填入  
  - 链接自动填入（网易云 URL）
```

### 7.2 结果页增强

**推荐歌曲卡片**（原来只有文字，现在加封面和链接）：

```
┌────────────────────────────────────────────┐
│  🎵 如果还想听一首                          │
│                                            │
│  [专辑封面] 《夜车》- 李志                  │
│             介于两首之间，有点公路...        │
│             [在网易云打开 →]                │
└────────────────────────────────────────────┘
```

**用户歌曲卡片**（有 URL 时加图标）：

```
《鸽子》- 李志    [🎵 网易云]
```

---

## 8. 数据库变更

### 新增（LangGraph Checkpointer 自动管理）

LangGraph PostgreSQL Checkpointer 会自动创建：
- `checkpoints` 表
- `checkpoint_blobs` 表  
- `checkpoint_writes` 表

调用 `checkpointer.setup()` 初始化即可。

### 修改 Room 表

```prisma
model Room {
  // 原有字段...
  
  // V2 字段（部分保留）
  agentPersonalityProfiles String?
  agentRelationship        String?
  agentNextSong            String?    // 现在包含 url 和 cover
  agentExecutionLog        String?

  // V3 新增
  // agentState 字段删除（由 Checkpointer 接管）
  // agentPhase 字段删除（从 Checkpointer 读取）
}
```

### 新增 MusicEntry 字段

```prisma
model MusicEntry {
  // 原有字段...
  neteaseId   Int?     // 网易云歌曲 ID
  coverUrl    String?  // 专辑封面 URL
}
```

---

## 9. 实现顺序

### Phase 1：Python Tool Server（3天）

**Day 1**
- 搭建 FastAPI 项目骨架
- 部署 NeteaseCloudMusicApi（Vercel）
- 实现 `/search` 接口并联调

**Day 2**
- 实现 `/verify` 接口 + `rapidfuzz` 模糊匹配
- 写单元测试（`pytest`）
- 部署到 Railway

**Day 3**
- 在 TypeScript 中封装 `searchNeteaseTool`
- 前端加搜索联想框
- 联调：前端搜索 → Python 服务 → 返回结果

**交付**：Python 服务上线，前端歌曲搜索可用

---

### Phase 2：LangGraph Tool Use（2天）

**Day 4**
- 改造 `generateSummaryNode` 为 ReAct 模式
- 绑定 `searchNeteaseTool`
- 本地测试推荐验证循环

**Day 5**
- 把验证结果（URL、封面）存入数据库
- 结果页推荐卡片展示封面和链接
- 执行日志加入 Tool Call 记录

**交付**：AI 推荐的歌曲有真实 URL，执行日志可见工具调用过程

---

### Phase 3：真正的 Human-in-the-loop（2天）

**Day 6**
- 安装 `@langchain/langgraph-checkpoint-postgres`
- 实现 `PostgresSaver` 初始化
- 重构完整工作流图（一个大图含 interrupt 节点）
- 本地测试 interrupt/resume 机制

**Day 7**
- 重构 API Routes：创建房间 → invoke，抽签/提交 → Command({resume})
- 清理 V2 的手动 state 序列化逻辑
- 端到端测试

**交付**：LangGraph 真正管理整个工作流，interrupt/resume 正常工作

---

### Phase 4：收尾（1天）

- 更新 README（含架构图、截图、两个服务的启动说明）
- 更新 `music-draw-agent-v3.md`
- 推送 GitHub 部署

---

## 10. 技术风险

| 风险 | 概率 | 应对 |
|---|---|---|
| NeteaseCloudMusicApi 被封 / 不稳定 | 中 | 准备降级逻辑，搜不到则直接返回无 URL |
| `@langchain/langgraph-checkpoint-postgres` API 变动 | 低 | 锁定版本，Phase 1 先验证 |
| Railway 免费额度限制 | 低 | 备选 Render 或 Fly.io |
| DeepSeek 不支持部分 Tool Use 格式 | 中 | 检查 DeepSeek function_call 兼容性，必要时换 GLM-4 |

---

## 11. 简历表达（V3 完成后）

> 设计并实现双人 AI 音乐抽签 Agent 系统，采用 TypeScript + Python 双语言架构：Next.js/LangGraph 负责 Agent orchestration，Python FastAPI 微服务作为音乐工具层（网易云搜索/验证）。实现了 LangGraph PostgreSQL Checkpointer 支持的真正 Human-in-the-loop（interrupt/resume），ReAct 模式的工具调用（AI 推荐歌曲前自动验证真实性），以及多轮对话主持人 Agent 和深度聊天性格分析。

**面试可讲的技术点（V3）**

1. **真正的 interrupt/resume**：LangGraph Checkpointer 如何在 Serverless 环境工作，thread_id 机制，checkpoint 数据库表结构
2. **ReAct 工具调用**：模型如何决定调用工具，多轮 tool_call 循环，置信度控制
3. **跨语言 Tool Server**：为什么把工具层放到 Python 微服务，FastAPI + pydantic 的设计，`rapidfuzz` 模糊匹配的必要性
4. **Serverless + 有状态 Agent 的矛盾**：每次请求都是无状态的，但 Agent 工作流需要跨请求保存状态，如何用 Checkpointer 解决
5. **Tool 降级策略**：网易云 API 不可用时如何保证主流程不中断

---

## 12. 不做的事

V3 明确不做：

- 网易云用户登录（OAuth 太重，不是核心 Agent 能力）
- Python 重写整个 orchestration（没必要，TS + LangGraph 已经很好）
- 歌词分析（范围蔓延）
- 实时音乐播放（版权问题）
- 多人房间（产品方向变化太大）
