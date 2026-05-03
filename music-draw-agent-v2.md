# 双人音乐抽签 Agent V2 技术规划

> 目标：将已跑通的 MVP 升级为有状态、可观察、人机协作的 Agent 系统，技术含量达到 Agent 开发岗简历水准。

---

## 1. 为什么要升级：V1 的技术局限

MVP 的三次 LLM 调用是这样的：

```
创建房间  →  analyzeChatAndGenerateTopics()   独立调用，无上下文
提交音乐  →  generateSummary()                独立调用，不知道前两次发生了什么
（无聊天时）→  generateTopicsFromMood()        独立调用
```

三次调用相互不认识，没有共享上下文，没有执行链路，无法暂停恢复，对面试官无法展示任何 Agent 思想。

V2 升级后变成：

```
[ 主持人对话 ] → [ 聊天深度分析 ] → [ 主题生成 ] → [ 等待抽签 ] → [ 等待提交 ] → [ 总结+推荐 ]
      ↑                ↑                 ↑               ↑               ↑              ↑
  多轮对话Agent    性格/关系分析       带推理过程      Human-in-loop   Human-in-loop   带下一首推荐
```

整个流程由 LangGraph 编排，状态全程共享，每一步可被记录和观测。

---

## 2. V2 新增四项核心能力

### 能力 A：LangGraph 工作流编排

把三个独立 LLM 调用重构为有状态图谱，展示工作流编排能力。

### 能力 B：多轮对话主持人 Agent

创建房间前加入一个对话入口，AI 主持人通过 2-3 轮对话了解背景，比单次输入氛围描述更深入。

### 能力 C：深度聊天分析

聊天记录分析从"提取关键词"升级为"识别双人性格标签和关系状态"，有更强的叙事价值。

### 能力 D：总结升级：下一首推荐

结果总结不止是氛围描述，还能根据两首歌的组合推荐下一首应该听什么，让产品更有价值感。

---

## 3. 技术栈

### 新增依赖

| 依赖 | 用途 |
|---|---|
| `@langchain/langgraph` | Agent 工作流编排，State 管理，Human-in-the-loop |
| `@langchain/core` | 消息格式（HumanMessage, AIMessage），工具定义 |
| `@langchain/openai` | ChatOpenAI 类（兼容 DeepSeek） |
| `zod` | Structured Output Schema 定义，节点输出类型校验 |

### 保留不变

| 依赖 | 用途 |
|---|---|
| Next.js 16 | 全栈框架，API Routes |
| Prisma + PostgreSQL | 数据层，新增 workflow state 字段 |
| DeepSeek API | LLM 服务，不换 |
| Tailwind CSS | 样式 |

### 明确不引入

- Redis：workflow state 直接序列化到 PostgreSQL，不额外增加基础设施
- 消息队列：两个人的场景，轮询已足够
- 向量数据库：本项目不需要 RAG

---

## 4. LangGraph 核心设计

### 4.1 Graph State 定义

Graph State 是整个工作流的共享上下文，所有节点读取并更新同一份数据。

```typescript
// lib/agent/state.ts

export interface PersonalityProfile {
  nickname: string
  participantId: string
  traits: string[]        // ["安静内敛", "爱怀旧", "理性"]
  musicStyle: string      // "偏向安静的叙事类，有点文艺"
}

export interface RelationshipAnalysis {
  type: string            // "多年老友" | "暧昧期" | "新认识" | "情侣"
  tone: string            // "轻松调侃" | "温柔细腻" | "久别重逢"
  sharedMoments: string[] // 从聊天中提取的共同记忆片段
}

export interface ExecutionLogEntry {
  node: string
  startAt: string
  endAt: string
  durationMs: number
  type: "llm" | "human" | "route"
  summary: string         // "分析了 245 字聊天记录，提取到 3 个性格标签"
  thinking?: string       // LLM 推理过程（CoT）摘要，可选展示
}

export interface MusicDrawState {
  // 基础信息
  roomId: string
  roomName: string
  inviteCode: string

  // 主持人对话历史
  hostConversation: Array<{ role: "user" | "assistant"; content: string }>
  hostConversationDone: boolean

  // 输入信息
  chatText?: string
  moodHint?: string

  // 深度分析结果（能力 C）
  personalityProfiles: PersonalityProfile[]   // 每人一份性格分析
  relationshipAnalysis?: RelationshipAnalysis  // 双人关系分析
  extractedMood: string                       // "轻松怀旧"
  extractedKeywords: string[]                 // ["公路", "夜晚", "南方"]

  // 主题池
  topics: string[]
  topicSource: "default" | "ai"

  // 参与者运行状态
  participants: Array<{
    id: string
    nickname: string
    drawnTopic?: string
    entry?: {
      songName: string
      artist: string
      musicUrl?: string
      reason?: string
    }
  }>

  // 工作流阶段
  phase:
    | "host_chat"       // 主持人多轮对话中
    | "analyzing"       // 聊天分析中
    | "topics_ready"    // 主题就绪，等待房间满员
    | "drawing"         // 等待双人抽签
    | "collecting"      // 等待双人提交音乐
    | "summarizing"     // 总结生成中
    | "done"            // 完成
    | "error"           // 错误

  // 最终产出（能力 D）
  summary?: string
  tags?: string[]
  nextSongRecommendation?: {
    songName: string
    artist: string
    reason: string       // "介于这两首歌之间的某种状态"
  }

  // Agent 执行日志（用于前端展示）
  executionLog: ExecutionLogEntry[]

  // 容错
  error?: string
  retryCount: number
}
```

### 4.2 Workflow 节点图

```
START
  │
  ▼
[hostChatNode]          ← 能力 B：主持人多轮对话
  │  (对话结束后推进)
  ▼
[routeAfterHostChat]    ← 条件路由：有聊天记录走分析，否则直接生成主题
  │                  │
  ▼                  ▼
[analyzeChatNode]   [generateTopicsNode]   ← 能力 C：深度分析
  │
  ▼
[generateTopicsNode]
  │
  ▼
[waitForDrawNode]       ← Human-in-the-loop：等待双人抽签
  │  (两人都抽完触发)
  ▼
[waitForEntriesNode]    ← Human-in-the-loop：等待双人提交音乐
  │  (两人都提交触发)
  ▼
[generateSummaryNode]   ← 能力 D：总结 + 下一首推荐
  │
  ▼
END
```

### 4.3 各节点详细设计

---

#### Node 1：hostChatNode（主持人对话）

**职责**：AI 主持人与用户进行 1-3 轮对话，收集场景信息，比单次输入更自然。

**触发时机**：用户在创建房间页点击"和 AI 聊聊"后开始对话，每次用户发消息都调用该节点。

**对话策略**：
- 第 1 轮：询问这次分享的背景（和谁、什么场合）
- 第 2 轮：了解最近的情绪或发生了什么
- 第 3 轮（可选）：确认是否有特别想要的主题方向

**结束条件**：用户主动说"好了"/"开始吧"，或已满 3 轮。

**System Prompt 设计**：
```
你是一个音乐抽签活动的 AI 主持人，性格温和、有点文艺，说话简洁不罗嗦。
你需要在 1-3 轮对话中了解用户这次音乐分享的背景，包括和谁分享、什么场合、最近的状态。
不要问超过一个问题，每次只问一件事。
当你觉得已经收集到足够信息时（或者用户说开始了），在回复末尾加上 [DONE]。
```

**输出**：更新 `hostConversation`，当检测到 `[DONE]` 时将 `hostConversationDone` 设为 `true`。

---

#### Node 2：routeAfterHostChat（条件路由）

**职责**：根据是否有聊天记录决定下一步。

**逻辑**：
```typescript
function routeAfterHostChat(state: MusicDrawState): string {
  if (state.chatText && state.chatText.length > 50) {
    return "analyzeChatNode"   // 有聊天记录，走深度分析
  }
  return "generateTopicsNode"  // 只有主持人对话结果，直接生成主题
}
```

---

#### Node 3：analyzeChatNode（深度聊天分析）

**职责**：分析聊天记录，输出性格标签、关系分析、情绪和关键词。

**与 V1 的区别**：V1 只提取 mood + keywords + topics，V2 新增 personalityProfiles 和 relationshipAnalysis。

**Prompt 设计**：
```
你是一个擅长从文字中读人的观察者。
请分析以下两人聊天记录，提取信息。

聊天记录：
{chatText}

主持人对话中收集的背景：
{hostConversation 摘要}

请严格按照 JSON 格式返回：
{
  "mood": "整体氛围，5字以内",
  "keywords": ["词1", "词2", "词3"],
  "relationship": {
    "type": "关系类型，例如：多年老友/暧昧期/新认识/情侣",
    "tone": "聊天语气，例如：轻松调侃/温柔细腻",
    "sharedMoments": ["片段1", "片段2"]  // 从聊天中提取的共同记忆，最多2条
  },
  "personality_a": {
    "nickname": "消息较多一方的称呼或留空",
    "traits": ["标签1", "标签2", "标签3"],
    "musicStyle": "推测的音乐偏好，15字以内"
  },
  "personality_b": {
    "nickname": "另一方的称呼或留空",
    "traits": ["标签1", "标签2"],
    "musicStyle": "推测的音乐偏好，15字以内"
  }
}

性格标签示例：安静内敛、爱怀旧、理性克制、情绪化、善用比喻、话少但精准
不要分析隐私信息，不要做过度解读，保持客观。
```

**CoT（推理过程）**：在节点中记录 LLM 返回的原始文本到 `executionLog[].thinking`，前端可折叠展示。

---

#### Node 4：generateTopicsNode（主题生成）

**职责**：基于分析结果或主持人对话信息生成主题池。

**输入来源**：
- 有聊天分析时：使用 mood + keywords + relationship.tone + 两人 musicStyle
- 仅有主持人对话时：提取对话中的关键信息生成

**Prompt 设计思路**：
- 将两人的 traits 和 musicStyle 传入
- 要求生成的主题词风格上贴合两人性格
- 例如两人都偏安静理性，则主题词偏"夜路、旷野、远方"而非"狂欢、派对"

**输出**：12-16 个主题词。

---

#### Node 5：waitForDrawNode（等待抽签，Human-in-the-loop）

**职责**：工作流在此节点挂起，等待两位参与者各自抽签。

**实现方式**：
- LangGraph 在此节点抛出 interrupt
- Workflow state 持久化到数据库
- 每次有人抽签时，API 更新 state 并调用 `workflow.resume()`
- Workflow 检查是否两人都有 `drawnTopic`，是则推进，否则继续挂起

**State 更新**：每次恢复时，传入 `{ participantId, drawnTopic }` 更新对应参与者。

---

#### Node 6：waitForEntriesNode（等待提交，Human-in-the-loop）

**职责**：工作流在此节点挂起，等待两位参与者提交音乐。

**与 waitForDraw 逻辑相同**，检测条件改为两人都有 `entry`。

---

#### Node 7：generateSummaryNode（总结+推荐）

**职责**：生成氛围总结、风格标签，以及"下一首推荐"。

**与 V1 的区别**：V1 只有 summary + tags，V2 新增 nextSongRecommendation。

**Prompt 设计**：

```
你是一个音乐局的旁观者，同时也是一个懂音乐的策展人。
根据以下信息写总结和推荐。

音乐局名称：{roomName}
两人关系：{relationship.type}，{relationship.tone}
{personA.nickname} 性格：{personA.traits}，抽到「{topic}」，推荐了《{song}》- {artist}，理由：{reason}
{personB.nickname} 性格：{personB.traits}，抽到「{topic}」，推荐了《{song}》- {artist}，理由：{reason}

请按 JSON 格式返回：
{
  "summary": "50-80字总结，第三人称旁观者视角，用意象不用评价",
  "tags": ["标签1", "标签2", "标签3"],
  "nextSongRecommendation": {
    "songName": "歌曲名",
    "artist": "歌手名",
    "reason": "30字以内，说明为什么推荐这首，语气像朋友推荐不像算法"
  }
}

总结规范：不得出现"默契""好听""非常"等套话，保留一些模糊感，不过度解释。
推荐规范：推荐一首真实存在的歌曲，风格介于两人选择之间，理由要有温度。
```

---

## 5. 主持人 Agent 前端设计

### 5.1 创建房间页新增"和 AI 聊聊"入口

在当前"氛围描述"输入框旁边，加一个按钮「和主持人聊聊」，点击展开对话窗口。

```
┌─────────────────────────────────────────────┐
│  这次想分享什么样的音乐氛围？                 │
│  ┌──────────────────────────────────────┐   │
│  │ 对话窗口                              │   │
│  │                                       │   │
│  │ 🎵 嗨，你们这次打算在什么场合分享？   │   │
│  │   一起开车、晚上聊天、还是别的？      │   │
│  │                                      │   │
│  │ [用户输入框]                [发送]   │   │
│  └──────────────────────────────────────┘   │
│  [跳过，直接开始]                             │
└─────────────────────────────────────────────┘
```

### 5.2 对话结束后的展示

对话结束后，在创建房间表单下方展示 AI 收集到的信息摘要：

```
🎵 AI 主持人已了解本次分享背景
氛围：晚上开车，怀旧
关键词：公路 / 南方 / 夜晚
```

用户点击「确认，生成主题」完成创建。

### 5.3 对话 API 设计

```http
POST /api/rooms/host-chat
Body: { message: string, conversationHistory: Message[], roomContext?: {...} }
Response: { reply: string, isDone: boolean, extractedInfo?: {...} }
```

此 API 不依赖 LangGraph，是一个独立的多轮对话接口，最终收集结果再传入创建房间 API。

---

## 6. 深度分析结果在前端的展示（能力 C）

### 6.1 在结果页新增"双人性格卡"

```
┌──────────────────────────────────────────────────────┐
│  🎭 你们这次的状态                                   │
│                                                      │
│  小杨：安静内敛 · 爱怀旧 · 话少但精准                │
│         音乐感觉：偏安静叙事，有点文艺               │
│                                                      │
│  小林：情绪化 · 善用比喻 · 喜欢意象                  │
│         音乐感觉：电影感，有戏剧性                   │
│                                                      │
│  你们的关系：多年老友，轻松调侃                       │
│  共同记忆：「那次去广州的高铁上」「上次一起看海」     │
└──────────────────────────────────────────────────────┘
```

### 6.2 在结果页新增"下一首推荐"区块（能力 D）

```
┌──────────────────────────────────────────────────────┐
│  🎵 如果还想听一首                                   │
│                                                      │
│  《夜车》 - 李志                                      │
│                                                      │
│  介于你们两首歌之间，有点公路，有点夜晚，            │
│  适合在车上或者睡前听一听。                          │
└──────────────────────────────────────────────────────┘
```

---

## 7. Agent 执行日志：把 AI 思考过程变成产品亮点

### 7.1 功能设计

在结果页底部加一个折叠面板「查看 AI 的工作过程」，展示整个 workflow 的执行轨迹。

这是直接面向面试官的展示点：让他们能看到 Agent 工作流不是黑盒。

```
▼ 查看 AI 的工作过程

✓ 主持人对话         2 轮对话，收集到背景：晚上开车、南方公路
✓ 聊天深度分析       1.3s，分析 312 字聊天记录
                     提取性格：小杨「安静内敛」，小林「情绪化」
                     关系：多年老友，轻松调侃
✓ 主题生成           0.9s，基于聊天分析生成 14 个主题词
                     主题风格偏「公路系、南方感」
✓ 等待双人抽签       人工操作
                     小杨 → 「公路」，小林 → 「南方」
✓ 等待双人提交       人工操作
                     两人均已提交
✓ 总结与推荐         1.6s，生成氛围总结 + 推荐《夜车》
```

### 7.2 数据结构

每个节点执行时在 `MusicDrawState.executionLog` 中追加一条：

```typescript
{
  node: "analyzeChatNode",
  startAt: "2025-01-01T22:00:00Z",
  endAt: "2025-01-01T22:00:01.3Z",
  durationMs: 1300,
  type: "llm",
  summary: "分析 312 字聊天记录，提取到 2 份性格档案和关系分析",
  thinking: "..."  // 可选，存储 LLM 的原始推理文本
}
```

---

## 8. 数据库变更

### 8.1 Room 表新增字段

```prisma
model Room {
  // 原有字段保留不变
  id           String  @id @default(cuid())
  name         String
  inviteCode   String  @unique
  status       String  @default("waiting")
  topicSource  String  @default("default")
  topics       String
  chatMood     String?
  chatKeywords String?
  aiSummary    String?
  aiTags       String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  expiresAt    DateTime

  // V2 新增字段
  threadId           String?   @unique  // LangGraph workflow thread ID
  agentState         String?            // 完整 MusicDrawState 的 JSON 序列化
  personalityProfiles String?           // JSON：双人性格档案
  relationshipAnalysis String?          // JSON：关系分析
  nextSongRecommendation String?        // JSON：下一首推荐
  executionLog       String?            // JSON：Agent 执行日志

  participants Participant[]
  entries      MusicEntry[]
}
```

**注意**：不新增独立的 workflow 表，直接在 Room 表扩展字段，减少 join 查询，也便于单条记录展示完整信息。

---

## 9. API 层重构

### 9.1 新增接口

#### 主持人对话

```http
POST /api/rooms/host-chat
```

```typescript
// 请求
{
  message: string
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
}

// 响应
{
  reply: string
  isDone: boolean
  extractedInfo?: {
    moodHint: string
    keywords: string[]
  }
}
```

此接口独立存在，不涉及 LangGraph，纯粹的多轮对话。对话结束后，前端把 `extractedInfo` 作为 `moodHint` 传给创建房间接口。

---

### 9.2 修改接口

#### 创建房间（启动 Workflow）

```http
POST /api/rooms
```

变化：创建房间时同步启动 LangGraph workflow，生成 `threadId` 存入 Room。

```typescript
// 请求（新增字段）
{
  name: string
  nickname: string
  moodHint?: string
  chatText?: string
  hostConversationHistory?: Message[]  // 主持人对话历史，新增
}

// 内部逻辑
const workflow = buildMusicDrawGraph()
const threadId = generateId()
const initialState: MusicDrawState = { ...}
await workflow.invoke(initialState, { configurable: { thread_id: threadId } })
// workflow 会自动执行到第一个 interrupt 节点并挂起
await prisma.room.create({ data: { ..., threadId, agentState: serialize(state) } })
```

---

#### 抽签（恢复 Workflow）

```http
POST /api/rooms/:roomId/draw
```

变化：更新数据库后，调用 `workflow.resume()` 恢复工作流。

```typescript
// 内部逻辑
const room = await prisma.room.findUnique(...)
const workflow = buildMusicDrawGraph()
const currentState = deserialize(room.agentState)

// 更新参与者状态
const updatedState = updateParticipantDraw(currentState, participantId, drawnTopic)

// 恢复 workflow，让它检查是否可以继续
await workflow.invoke(
  { resume: updatedState },
  { configurable: { thread_id: room.threadId } }
)

// 保存最新 state
await prisma.room.update({ data: { agentState: serialize(updatedState) } })
```

---

#### 提交音乐（恢复 Workflow，自动触发总结）

```http
POST /api/rooms/:roomId/entries
```

变化：两人都提交后，workflow 自动推进到 `generateSummaryNode`，生成总结和推荐，无需前端再单独调用总结接口。原有的 `/api/rooms/:roomId/summary` 接口可以保留作为降级手动触发。

---

#### 获取房间状态（返回完整 Agent State）

```http
GET /api/rooms/:roomId
```

变化：响应中新增 `agentPhase`、`personalityProfiles`、`relationshipAnalysis`、`nextSongRecommendation`、`executionLog` 字段，前端根据这些字段渲染新 UI。

---

## 10. 实现顺序（5 个阶段）

### Phase 1：LangGraph 环境验证（1 天）

**目标**：确保 LangGraph 在 Next.js + Vercel 环境中可以正确运行。

**具体工作**：
1. 安装依赖：`npm install @langchain/langgraph @langchain/core @langchain/openai zod`
2. 新建 `lib/agent/demo.ts`，写一个最简单的 2 节点 workflow：
   - Node A：接收输入文本，调用 LLM 提取关键词
   - Node B：接收关键词，调用 LLM 生成主题词
3. 写一个 API Route `GET /api/test-agent` 触发这个 demo workflow
4. 本地跑通，确认 state 在节点间正确传递
5. 确认 Human-in-the-loop 的 interrupt / resume 机制可用

**交付**：`lib/agent/demo.ts`，可在本地 `curl` 触发并看到结果。

**风险应对**：如果 LangGraph JS 的 interrupt 机制文档不清晰，本阶段就识别出来，提前规避。

---

### Phase 2：核心 Graph 搭建（2-3 天）

**目标**：不改任何现有 API，先把完整的 `MusicDrawGraph` 写出来并能独立测试。

**具体工作**：
1. 新建 `lib/agent/state.ts`：定义 `MusicDrawState` 接口
2. 新建 `lib/agent/nodes.ts`：实现所有节点函数
   - `analyzeChatNode`：复用 V1 Prompt，扩展性格分析输出
   - `generateTopicsNode`：调整 Prompt，接收性格信息
   - `generateSummaryNode`：扩展 Prompt，新增 nextSongRecommendation
   - `waitForDrawNode` / `waitForEntriesNode`：实现 interrupt 逻辑
3. 新建 `lib/agent/graph.ts`：组装节点和边，编译 Graph
4. 写测试脚本 `lib/agent/test.ts`，模拟完整流程：
   - 提供测试聊天记录
   - 模拟两次 resume（抽签、提交）
   - 验证最终 state 包含 summary 和 nextSongRecommendation

**交付**：`lib/agent/` 目录，包含完整 Graph，可用 `ts-node` 独立运行。

---

### Phase 3：数据库 + API 重构（2 天）

**目标**：将 Graph 接入现有 API Routes，功能上与 V1 等价（不破坏现有用户流程）。

**具体工作**：
1. 更新 `prisma/schema.prisma`，新增 `threadId`、`agentState` 等字段
2. 运行 `npx prisma migrate dev --name add_agent_fields`
3. 重构 `app/api/rooms/route.ts`（创建房间）：启动 workflow
4. 重构 `app/api/rooms/[roomId]/draw/route.ts`：恢复 workflow
5. 重构 `app/api/rooms/[roomId]/entries/route.ts`：恢复 workflow，自动触发总结
6. 更新 `app/api/rooms/[roomId]/route.ts`：返回 agentState 中的扩展字段
7. 全流程端到端测试（不改前端）

**交付**：所有 API Routes 重构完成，用 curl 或 Postman 验证完整流程可跑通。

---

### Phase 4：主持人 Agent + 前端升级（2 天）

**目标**：新增主持人对话功能，前端展示深度分析结果和下一首推荐。

**具体工作**：
1. 新建 `app/api/rooms/host-chat/route.ts`：主持人多轮对话接口
2. 前端首页新增「和 AI 聊聊」对话窗口组件
3. 结果页新增「双人性格卡」区块
4. 结果页新增「下一首推荐」区块
5. 结果页新增「Agent 执行日志」折叠面板

**交付**：完整的前端页面升级，可以从主持人对话一路跑到结果展示。

---

### Phase 5：测试、优化与部署（1 天）

**目标**：上线并验证 Vercel 环境中 LangGraph 正常工作。

**具体工作**：
1. 并发测试：两人同时抽签时 state 更新是否正确
2. 降级测试：LLM 失败时是否回退到默认主题
3. 持久化测试：重启服务后 state 是否可以正确恢复
4. 推送 GitHub，触发 Vercel 部署
5. 更新 README：加入 Agent workflow 架构图
6. 更新简历描述

**交付**：上线可访问，文档完备。

---

## 11. 关键实现细节

### LangGraph 在 Serverless 的持久化方案

Vercel 的 Serverless Functions 每次请求都是无状态的，LangGraph workflow 的内存状态不能跨请求保留。

解决方案：每次请求结束时，将完整的 `MusicDrawState` 序列化为 JSON 存入 `Room.agentState`；下次请求开始时反序列化并传给 workflow。

```typescript
// 保存 state
await prisma.room.update({
  where: { id: roomId },
  data: { agentState: JSON.stringify(currentState) }
})

// 恢复 state
const room = await prisma.room.findUnique({ where: { id: roomId } })
const state: MusicDrawState = JSON.parse(room.agentState!)
```

这比 LangGraph 官方的 MemorySaver 或 SqliteSaver 更适合 Serverless 环境。

---

### 主持人对话的多轮上下文管理

主持人对话不使用 LangGraph，而是用简单的消息数组传递上下文：

```typescript
// 前端每次发消息，带上完整对话历史
const response = await fetch("/api/rooms/host-chat", {
  body: JSON.stringify({
    message: userInput,
    conversationHistory: messages  // 完整历史，服务端不存储
  })
})
```

服务端只负责续写对话并返回，历史由前端 localStorage 维护，简单可靠。

---

### 两人并发抽签的一致性保证

两人可能几乎同时抽签，需保证：
1. 抽签用数据库事务（V1 已实现）
2. 两人抽签更新 state 时，使用乐观锁或串行更新，避免覆盖

```typescript
// 使用 Prisma 事务 + 原子更新
await prisma.$transaction(async (tx) => {
  const room = await tx.room.findUnique({ where: { id: roomId } })
  const state = JSON.parse(room.agentState!)
  // 更新 state 后写回
  await tx.room.update({ data: { agentState: JSON.stringify(updatedState) } })
})
```

---

## 12. 技术风险

| 风险 | 概率 | 影响 | 应对 |
|---|---|---|---|
| LangGraph JS interrupt/resume 文档不完整 | 中 | 高 | Phase 1 专门验证，准备用手动状态机模拟 |
| 性格分析 Prompt 效果不稳定 | 中 | 中 | 加 fallback，默认返回通用标签，不影响主流程 |
| nextSongRecommendation 推荐了不存在的歌 | 高 | 低 | 标注"AI 推荐，请自行确认是否存在"，前端加免责说明 |
| Vercel 冷启动导致 LangGraph 初始化慢 | 低 | 低 | workflow 编译一次缓存，不影响核心体验 |
| agentState JSON 体积过大 | 低 | 低 | hostConversation 最多保留 6 条，executionLog 最多保留 10 条 |

---

## 13. 简历表达

V2 完成后，简历描述：

> 基于 LangGraph 设计并实现双人音乐抽签 AI Agent 系统。将分散的 LLM 调用重构为有状态的多步骤工作流，支持 Human-in-the-loop 在用户操作节点挂起和恢复；实现多轮对话主持人 Agent 收集场景背景；对聊天记录做深度分析，输出双人性格档案和关系标签；结果页包含"下一首推荐"和可观测的 Agent 执行链路。技术栈：Next.js / LangGraph / DeepSeek / Prisma / PostgreSQL / Vercel。

**面试可展示和讲解的内容**：

1. **LangGraph State 设计**：为什么这样设计 state，`executionLog` 的作用，如何权衡字段粒度
2. **Human-in-the-loop 原理**：interrupt 和 resume 机制，如何做到"等待用户操作后继续工作流"
3. **Serverless 持久化**：为什么不用 MemorySaver，JSON 序列化到数据库的方案及权衡
4. **主持人多轮对话**：为什么这部分不用 LangGraph，消息历史管理方式
5. **性格标签分析**：Prompt 设计思路，如何避免隐私问题，如何做降级
6. **并发安全**：两人同时操作时 state 更新的一致性保证

---

## 14. 不做的事（防范围蔓延）

V2 阶段明确不做：

- 不接入网易云音乐 API
- 不做多人房间
- 不做 Streaming 流式输出
- 不做 Agent 自主规划（自动决定下一步）
- 不做 RAG 或向量检索
- 不做用户账号体系
- 不做语音输入

这些都可以作为 V3 方向，但 V2 的核心价值是把 Agent 工作流做扎实、做可观测、做可讲解。
