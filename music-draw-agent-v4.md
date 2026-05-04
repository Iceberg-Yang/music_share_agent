# 双人音乐抽签 Agent V4 技术规划

> 核心目标：让 Agent 从"一次性工具"升级为"认识你的陪伴者"。
> 通过记忆系统、思考过程可视化、双人互动环节，让两个人在同一个 Agent 的见证下积累共同的音乐历史。

---

## 1. V3 现状与 V4 目标

### V3 已有

- LangGraph 完整图（真正的 Human-in-the-loop + interrupt/resume）
- Tool Use + ReAct（searchNeteaseTool 验证推荐歌曲）
- PostgreSQL Checkpointer（跨 Serverless 状态持久化）
- Python FastAPI 微服务（网易云搜索 + 模糊匹配）
- 前端歌曲搜索联想框
- Agent 执行日志（静态展示）

### V3 存在的问题

**问题 1：Agent 没有记忆**
每次游戏结束，Agent 忘记所有上下文。第二次玩时，主持人还在问同样的问题，总结里没有任何历史感，像两个陌生人每次重新认识。

**问题 2：两人缺乏共同的游戏体验**
两人在各自手机上独立操作，等待结果时屏幕空白，没有"我们在一起等待"的仪式感。AI 的思考过程完全不可见。

**问题 3：互动太线性**
抽签 → 提交 → 看结果，中间没有任何双向互动环节。结果看完也就结束了，没有留下反馈的空间。

### V4 新增四项能力

| 能力 | 核心价值 | 技术实现 |
|------|---------|---------|
| A. 记忆系统 | Agent 认识你，积累你们的音乐历史 | UserMemory + PairMemory + LangGraph 新节点 |
| B. Agent 思考直播 | 等待时两人共同观看 AI 思考过程 | 轮询 + 逐条展示执行日志 |
| C. 互猜环节 | 抽签后增加一轮双人互动 | 新的游戏阶段 + 数据库字段 |
| D. 结果页留言 | 对 AI 总结给出反应，留下印记 | Reaction 表 + 实时同步 |

---

## 2. 整体架构变化

```
V3 架构：
  创建房间 → [interrupt] → 抽签 → [interrupt] → 提交 → 生成总结 → 结果

V4 架构：
  ┌─────────────────────────────────────────────────────────┐
  │ loadMemoryNode（加载双方历史记忆）← 新增               │
  └────────────────────────┬────────────────────────────────┘
                           ↓
  analyzeChatNode → generateTopicsNode
                           ↓
           [interrupt: waiting_for_draws]
                           ↓
  ┌─────────────────────────────────────────────────────────┐
  │ 互猜环节：猜对方主题 ← 新增                             │
  └────────────────────────┬────────────────────────────────┘
                           ↓
           [interrupt: waiting_for_entries]
                           ↓
  generateSummaryNode（注入记忆上下文，生成有历史感的总结）
                           ↓
  ┌─────────────────────────────────────────────────────────┐
  │ updateMemoryNode（静默更新记忆，不阻塞用户）← 新增      │
  └────────────────────────┬────────────────────────────────┘
                           ↓
                          END

  全程：思考日志实时推送 → 前端逐条展示
  结束后：结果页留言 + 反应按钮
```

---

## 3. 功能 A：记忆系统

### 3.1 用户识别（无需登录）

```typescript
// lib/userIdentity.ts
export function getUserId(): string {
  if (typeof window === "undefined") return "";
  let uid = localStorage.getItem("music_uid");
  if (!uid) {
    uid = `u_${nanoid(12)}`;
    localStorage.setItem("music_uid", uid);
  }
  return uid;
}

// 可选：显示"记忆码"让用户跨设备导入
export function getMemoryCode(): string {
  return getUserId().replace("u_", "MUSIC-").toUpperCase();
}
```

**机制**：首次访问时在 `localStorage` 写入一个随机 ID，之后每次访问读取同一个 ID。同设备同浏览器内持久化，无需账号。

---

### 3.2 数据库新增两张表

```prisma
// prisma/schema.prisma 新增

model UserMemory {
  id          String   @id @default(cuid())
  userId      String   @unique

  gamesPlayed Int      @default(0)
  nickname    String?  // 最近使用的昵称

  // JSON: { styles: string[], keywords: string[], songs: SongRecord[] }
  musicDNA    String?

  // JSON: { topics: string[] }（玩过的主题，避免重复推荐）
  usedTopics  String?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model PairMemory {
  id          String   @id @default(cuid())

  // 由两个 userId 排序后拼接生成，确保唯一
  // e.g. SHA256("u_aaa" + "_" + "u_bbb")
  pairId      String   @unique

  gamesPlayed Int      @default(0)

  // JSON: GameSnapshot[]
  // { gameId, date, topicA, topicB, songA, songB, summary }
  gameHistory String?

  // JSON: string[]（累计的关系标签，如"夜晚偏好者""公路旅行感"）
  relationTags String?

  // JSON: string[]（累计出现的氛围词）
  cumulativeMood String?

  updatedAt   DateTime @updatedAt
}

// 结果页留言
model GameReaction {
  id            String   @id @default(cuid())
  roomId        String
  participantId String
  userId        String?  // 可选，匿名也可以留言

  // "accurate" | "close" | "miss"
  accuracyVote  String?

  comment       String?  @db.VarChar(100)

  createdAt     DateTime @default(now())

  room          Room     @relation(fields: [roomId], references: [id])
}
```

---

### 3.3 记忆相关类型定义

```typescript
// lib/memory/types.ts

export interface SongRecord {
  songName: string;
  artist: string;
  topic: string;
  date: string; // ISO string
}

export interface MusicDNA {
  styles: string[];       // 音乐风格标签
  keywords: string[];     // 高频情绪/意象词
  songs: SongRecord[];    // 历史选歌（最近 10 首）
}

export interface GameSnapshot {
  gameId: string;
  date: string;
  topicA: string;
  topicB: string;
  songA: { name: string; artist: string };
  songB: { name: string; artist: string };
  summaryExcerpt: string; // 总结前 50 字
}

export interface UserMemoryData {
  gamesPlayed: number;
  nickname?: string;
  musicDNA?: MusicDNA;
  usedTopics?: string[];
}

export interface PairMemoryData {
  gamesPlayed: number;
  gameHistory: GameSnapshot[];
  relationTags: string[];
  cumulativeMood: string[];
}
```

---

### 3.4 LangGraph 新节点：loadMemoryNode

```typescript
// lib/agent/memoryNodes.ts

export async function loadMemoryNode(
  state: typeof FullGameAnnotation.State
): Promise<Partial<typeof FullGameAnnotation.State>> {
  const start = new Date();

  // userIdA / userIdB 由前端传入，存入 state
  if (!state.userIdA && !state.userIdB) {
    return {
      executionLog: [makeLogEntry("loadMemoryNode", "route", start, new Date(), "无用户ID，跳过记忆加载")],
    };
  }

  const [memA, memB, pairMem] = await Promise.all([
    getUserMemory(state.userIdA),
    getUserMemory(state.userIdB),
    getPairMemory(state.userIdA, state.userIdB),
  ]);

  const summary = buildMemorySummary(memA, memB, pairMem);
  const end = new Date();

  return {
    userMemories: [memA, memB],
    pairMemory: pairMem,
    memoryContextSummary: summary,
    executionLog: [
      makeLogEntry(
        "loadMemoryNode",
        "llm",
        start,
        end,
        pairMem?.gamesPlayed
          ? `加载记忆：这是第 ${pairMem.gamesPlayed + 1} 局，上次玩于 ${pairMem.gameHistory?.at(-1)?.date?.slice(0, 10)}`
          : "首次相遇，初始化记忆"
      ),
    ],
  };
}

// 把记忆结构化为 prompt 可用的文字摘要
function buildMemorySummary(
  memA?: UserMemoryData,
  memB?: UserMemoryData,
  pair?: PairMemoryData
): string {
  const parts: string[] = [];

  if (pair?.gamesPlayed) {
    parts.push(`这是两人第 ${pair.gamesPlayed + 1} 次一起玩。`);
    const lastGame = pair.gameHistory?.at(-1);
    if (lastGame) {
      parts.push(
        `上次（${lastGame.date.slice(0, 10)}）：${lastGame.topicA}/${lastGame.topicB}，` +
        `分别选了《${lastGame.songA.name}》和《${lastGame.songB.name}》。`
      );
    }
    if (pair.cumulativeMood?.length) {
      parts.push(`两人共同的氛围词：${pair.cumulativeMood.slice(0, 5).join("、")}。`);
    }
  }

  if (memA?.musicDNA?.styles?.length) {
    parts.push(`参与者A偏好：${memA.musicDNA.styles.slice(0, 3).join("、")}。`);
  }
  if (memB?.musicDNA?.styles?.length) {
    parts.push(`参与者B偏好：${memB.musicDNA.styles.slice(0, 3).join("、")}。`);
  }

  return parts.join("") || "";
}
```

---

### 3.5 LangGraph 新节点：updateMemoryNode

```typescript
export async function updateMemoryNode(
  state: typeof FullGameAnnotation.State
): Promise<Partial<typeof FullGameAnnotation.State>> {
  const start = new Date();

  // 异步写入，不等待结果（不阻塞用户看结果）
  updateMemoriesAsync(state).catch((e) =>
    console.error("[updateMemoryNode] 写入失败:", e)
  );

  return {
    executionLog: [
      makeLogEntry("updateMemoryNode", "route", start, new Date(), "记忆更新中（后台异步）"),
    ],
  };
}

async function updateMemoriesAsync(state: typeof FullGameAnnotation.State) {
  const [a, b] = state.participants;
  const roomId = state.roomId;

  // 用 AI 从本局提取风格标签和关键词，更新用户 DNA
  const [dnaA, dnaB] = await Promise.all([
    extractMusicDNA(a, state.extractedKeywords, state.extractedMood),
    extractMusicDNA(b, state.extractedKeywords, state.extractedMood),
  ]);

  // 构建本局快照
  const snapshot: GameSnapshot = {
    gameId: roomId,
    date: new Date().toISOString(),
    topicA: a.drawnTopic,
    topicB: b.drawnTopic,
    songA: { name: a.entry.songName, artist: a.entry.artist },
    songB: { name: b.entry.songName, artist: b.entry.artist },
    summaryExcerpt: state.summary?.slice(0, 50) ?? "",
  };

  await Promise.all([
    upsertUserMemory(state.userIdA, dnaA, a),
    upsertUserMemory(state.userIdB, dnaB, b),
    upsertPairMemory(state.userIdA, state.userIdB, snapshot, state),
  ]);
}
```

---

### 3.6 记忆在 Prompt 中的注入

```typescript
// generateTopicsNode 的 prompt 中加入：
if (state.memoryContextSummary) {
  contextParts.push(`历史记忆：${state.memoryContextSummary}`);
  contextParts.push(`请避开已用过的主题：${state.usedTopics?.join("、")}`);
}

// generateSummaryNode 的 prompt 中加入：
const memoryContext = state.pairMemory?.gamesPlayed
  ? `\n历史背景：${state.memoryContextSummary}\n请在总结中自然地引用历史，体现这是第 ${state.pairMemory.gamesPlayed + 1} 局。`
  : "";
```

---

### 3.7 首页"欢迎回来"展示

```typescript
// app/page.tsx 新增：加载用户记忆并展示

useEffect(() => {
  const uid = getUserId();
  if (!uid) return;
  fetch(`/api/memory/user?userId=${uid}`)
    .then(r => r.json())
    .then(data => {
      if (data.gamesPlayed > 0) setUserMemory(data);
    });
}, []);

// UI
{userMemory && (
  <div className="bg-gray-900 rounded-xl p-4 text-sm text-gray-400 mb-4">
    <p>上次你选了《{userMemory.lastSong}》</p>
    <p className="text-xs text-gray-600 mt-1">已玩 {userMemory.gamesPlayed} 局</p>
  </div>
)}
```

---

## 4. 功能 B：Agent 思考过程直播

### 4.1 机制设计

不需要 SSE，用**轮询**即可（每 1.5 秒请求一次）：
- 前端在进入"等待总结"状态时开始轮询 `/api/rooms/[roomId]`
- 服务端把执行日志按 `startAt` 排序后返回
- 前端维护一个"已展示数量"的指针，每次有新条目就加入动画队列
- 每条日志出现时有打字机动画效果

### 4.2 前端展示组件

```typescript
// components/AgentThinking.tsx

function AgentThinking({ roomId }: { roomId: string }) {
  const [visibleLogs, setVisibleLogs] = useState<ExecutionLogEntry[]>([]);
  const shownCount = useRef(0);

  useEffect(() => {
    const timer = setInterval(async () => {
      const res = await fetch(`/api/rooms/${roomId}`);
      const data = await res.json();
      const logs: ExecutionLogEntry[] = data.agentExecutionLog ?? [];

      // 只追加新的条目
      if (logs.length > shownCount.current) {
        const newLogs = logs.slice(shownCount.current);
        shownCount.current = logs.length;
        setVisibleLogs(prev => [...prev, ...newLogs]);
      }

      // 游戏结束则停止轮询
      if (data.status === "completed") clearInterval(timer);
    }, 1500);

    return () => clearInterval(timer);
  }, [roomId]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Agent 正在思考...</p>
      {visibleLogs.map((log, i) => (
        <div
          key={i}
          className="flex items-start gap-2 text-xs animate-fade-in"
        >
          <span className="text-indigo-400 mt-0.5">
            {log.type === "llm" ? "⚙" : log.type === "human" ? "👤" : "→"}
          </span>
          <div>
            <span className="text-gray-300">{log.summary}</span>
            <span className="text-gray-600 ml-2">{log.durationMs}ms</span>
          </div>
        </div>
      ))}
      {/* 最后一条之后显示加载动画 */}
      <div className="flex gap-1 pl-4">
        <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" />
        <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce delay-100" />
        <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce delay-200" />
      </div>
    </div>
  );
}
```

---

## 5. 功能 C：互猜环节

### 5.1 流程设计

```
抽签完成后，进入新阶段 "guessing"
         ↓
每人看到自己的主题
         ↓
"猜猜对方抽到了什么主题？"（从主题池里随机抽 4 个含正确答案的选项）
         ↓
两人都猜完后，进入提交歌曲阶段
         ↓
揭晓：猜对/猜错，对方主题是什么
```

### 5.2 数据库变更

```prisma
// Participant 表新增
model Participant {
  // ...现有字段
  guess        String?  // 猜测对方主题
  guessCorrect Boolean? // 是否猜对（提交后服务端计算）
}
```

### 5.3 API 新增

```typescript
// POST /api/rooms/[roomId]/guess
// body: { participantId, sessionToken, guess: string }
```

### 5.4 前端新阶段

```
type Stage = "waiting" | "draw" | "guessing" | "submit" | "result"
```

猜题界面：
```
┌────────────────────────────────┐
│  你抽到了：夜晚                 │
│                                │
│  猜猜对方抽到了什么？           │
│                                │
│  ○ 公路    ○ 颜色              │
│  ● 天空    ○ 海边              │  ← 选中状态
│                                │
│  [确认]                        │
└────────────────────────────────┘
```

揭晓时（在提交页顶部）：
```
┌────────────────────────────────┐
│  对方的主题是：公路             │
│  你猜的是：天空                 │
│  ✗ 差一点 — 但也许夜晚和公路   │
│    本来就是同一条路。           │
└────────────────────────────────┘
```

最后一句"但也许..."由 LLM 根据两个主题即兴生成。

---

## 6. 功能 D：结果页留言

### 6.1 UI 设计

总结展示完后，在页面底部：

```
┌────────────────────────────────────────┐
│  AI 说得准吗？                          │
│                                        │
│  [✓ 说到了]  [≈ 差一点]  [✗ 完全不对] │
│                                        │
│  留一句话（可选）                       │
│  ┌─────────────────────────────────┐   │
│  │ 其实那首歌是另一个故事              │   │
│  └─────────────────────────────────┘   │
│  [提交]                                │
│                                        │
│  对方说：[≈ 差一点]                    │
│  "准但不全对"                          │
└────────────────────────────────────────┘
```

### 6.2 API

```typescript
// POST /api/rooms/[roomId]/reaction
// body: { participantId, sessionToken, accuracyVote, comment }

// GET /api/rooms/[roomId]/reactions（结果页轮询获取双方留言）
```

### 6.3 留言写入记忆

`accuracyVote` 写入 PairMemory，下次游戏结束时 AI 可以引用：
```
上次 A 觉得总结"说到了"，B 觉得"差一点"
```

---

## 7. FullGameAnnotation 更新

V4 需要在现有 state 里新增字段：

```typescript
export const FullGameAnnotation = Annotation.Root({
  // ...现有字段

  // V4 新增：记忆系统
  userIdA: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  userIdB: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  userMemories: Annotation<UserMemoryData[]>({ value: (_p, n) => n, default: () => [] }),
  pairMemory: Annotation<PairMemoryData | undefined>({ value: (_p, n) => n, default: () => undefined }),
  memoryContextSummary: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
  usedTopics: Annotation<string[]>({ value: (_p, n) => n, default: () => [] }),

  // V4 新增：互猜
  guesses: Annotation<Record<string, string>>({ value: (_p, n) => n, default: () => ({}) }),
  guessRevealText: Annotation<string>({ value: (_p, n) => n, default: () => "" }),
});
```

---

## 8. 完整 LangGraph V4 图

```typescript
const graph = new StateGraph(FullGameAnnotation)
  .addNode("loadMemoryNode", loadMemoryNode)       // 新增
  .addNode("analyzeChatNode", fullAnalyzeChatNode)
  .addNode("generateTopicsNode", fullGenerateTopicsNode)
  .addNode("waitForDrawsNode", waitForDrawsNode)   // 含互猜 interrupt
  .addNode("waitForEntriesNode", waitForEntriesNode)
  .addNode("generateSummaryNode", fullGenerateSummaryNode)
  .addNode("updateMemoryNode", updateMemoryNode)   // 新增
  .addEdge(START, "loadMemoryNode")                // 从记忆开始
  .addEdge("loadMemoryNode", "analyzeChatNode")
  .addEdge("analyzeChatNode", "generateTopicsNode")
  .addEdge("generateTopicsNode", "waitForDrawsNode")
  .addEdge("waitForDrawsNode", "waitForEntriesNode")
  .addEdge("waitForEntriesNode", "generateSummaryNode")
  .addEdge("generateSummaryNode", "updateMemoryNode") // 新增
  .addEdge("updateMemoryNode", END);
```

---

## 9. 数据库迁移

```sql
-- 新增 UserMemory 表
CREATE TABLE "UserMemory" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "userId"      TEXT NOT NULL UNIQUE,
  "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
  "nickname"    TEXT,
  "musicDNA"    TEXT,
  "usedTopics"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);

-- 新增 PairMemory 表
CREATE TABLE "PairMemory" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "pairId"         TEXT NOT NULL UNIQUE,
  "gamesPlayed"    INTEGER NOT NULL DEFAULT 0,
  "gameHistory"    TEXT,
  "relationTags"   TEXT,
  "cumulativeMood" TEXT,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);

-- 新增 GameReaction 表
CREATE TABLE "GameReaction" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "roomId"        TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "userId"        TEXT,
  "accuracyVote"  TEXT,
  "comment"       TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Participant 表新增互猜字段
ALTER TABLE "Participant" ADD COLUMN "guess"        TEXT;
ALTER TABLE "Participant" ADD COLUMN "guessCorrect" BOOLEAN;
```

---

## 10. 实现顺序

```
Phase 1（2 天）：数据库 + 记忆 CRUD
  - schema.prisma 新增三张表 + 执行迁移
  - lib/memory/ 目录：getUserMemory、upsertUserMemory、getPairMemory
  - /api/memory/user 接口

Phase 2（1.5 天）：LangGraph 接入记忆
  - loadMemoryNode + updateMemoryNode
  - FullGameAnnotation 新增字段
  - generateTopicsNode / generateSummaryNode prompt 注入记忆上下文
  - 前端 getUserId() + 传 userId 到创建房间 API

Phase 3（1 天）：思考直播
  - AgentThinking 组件
  - 等待总结阶段接入轮询

Phase 4（1 天）：互猜环节
  - Participant 新字段 + /api/rooms/[roomId]/guess
  - 前端新增 guessing 阶段
  - 揭晓文案 LLM 生成

Phase 5（0.5 天）：结果页留言
  - GameReaction 表 + /api/rooms/[roomId]/reaction
  - 前端投票 + 留言 UI
  - 写入 PairMemory

Phase 6（0.5 天）：首页欢迎回来
  - 读取用户记忆展示上次选歌
  - 结果页局数标签 + 历史折叠栏
```

---

## 11. 简历叙事升级

完成 V4 后，项目可以描述为：

> **具备长期记忆的双人音乐 Agent**
>
> 基于 LangGraph HITL + PostgreSQL Checkpointer 构建，Agent 跨会话追踪用户音乐偏好 DNA，积累双人关系记忆，动态调整主持对话策略和主题生成。集成 Python FastAPI 工具层（网易云搜索+模糊匹配）实现 Tool Use + ReAct 推荐验证。包含思考过程可视化、互猜互动环节、留言反馈闭环，覆盖 Agent 感知、记忆、规划、行动四大核心能力。
>
> 技术栈：Next.js / TypeScript + LangGraph + PostgreSQL + Python FastAPI + DeepSeek LLM
