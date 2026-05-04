# 双人音乐抽签 Agent V4 技术规划

> **核心目标**：让 Agent 从"一次性工具"升级为"认识你的陪伴者"。
> 通过记忆系统、思考过程可视化、AI 引导猜谜、结果反馈，让两个人在同一个 Agent 的见证下积累共同的音乐历史。

---

## 1. V3 现状与 V4 目标

### V3 已有

- LangGraph 完整游戏图（真正的 Human-in-the-loop + interrupt/resume）
- Tool Use + ReAct（searchNeteaseTool 验证推荐歌曲）
- PostgreSQL Checkpointer（跨 Serverless 状态持久化）
- Python FastAPI 微服务（网易云搜索 + rapidfuzz 模糊匹配）
- 前端歌曲搜索联想框
- Agent 执行日志（静态展示）

### V4 新增五项能力

| 能力 | 核心价值 | 技术方向 |
|------|---------|---------|
| A. 记忆系统 | Agent 认识你，积累音乐历史 | UserMemory + PairMemory + LangGraph 新节点 |
| B. Agent 思考直播 | 等待时共同观看 AI 工作过程 | 轮询执行日志 + 逐条动画展示 |
| C. AI 引导猜谜（本文重点） | 用独立 LangGraph 图实现多轮 AI 主持猜题 | 独立 GuessChatGraph + Python 语义裁判 |
| D. 结果页留言 | 对 AI 总结给出反应，留下印记 | GameReaction 表 + 实时同步 |
| E. 首页欢迎回来 | 有历史感的开场 | 读取 UserMemory 展示 |

---

## 2. 整体架构

### 主游戏图（MainGameGraph）——已实现，V4 扩展

```
loadMemoryNode（加载双方历史记忆）
        ↓
analyzeChatNode → generateTopicsNode
        ↓
[interrupt: waiting_for_draws]     ← 抽签
        ↓
[interrupt: waiting_for_entries]   ← 提交歌曲
        ↓
generateSummaryNode（注入记忆上下文）
        ↓
updateMemoryNode（后台异步写入记忆）
        ↓
       END
```

### 猜谜图（GuessChatGraph）——V4 新增独立图

```
START
  ↓
generateHintNode            ← AI 根据歌曲生成第一条隐晦线索
  ↓
[interrupt: waiting_for_guess]  ← 等待用户输入猜测词
  ↓
judgeGuessNode              ← AI + Python 语义裁判（correct / close / wrong）
  ↓
───── 条件路由 ─────────────────────────────────────────
  correct          → revealNode（庆祝揭晓）→ END
  close/wrong
  attempts < max   → generateHintNode（生成下一条提示）← 循环
  attempts >= max  → revealNode（强制揭晓）→ END
────────────────────────────────────────────────────────
  ↓
revealNode                  ← 生成有温度的揭晓文案
  ↓
 END
```

**图的隔离策略**：
- 主游戏图：`thread_id = inviteCode`
- 猜谜图：`thread_id = ${inviteCode}_guess_${participantId}`
- 两图使用同一个 PostgresSaver，但 thread 完全独立，互不干扰
- 每个玩家有自己独立的猜谜对话，互相不可见

---

## 3. 功能 A：记忆系统（已实现）

> Phase 1 & 2 在当前代码中已基本实现，此处仅记录设计原则供参考。

### 设计原则

- **用户识别**：`localStorage` 存 `u_xxx` 格式的设备 ID，无需登录
- **双人配对**：对两个 userId 排序拼接生成 pairId，确保 A+B = B+A
- **主游戏图接入**：`loadMemoryNode` 开局加载，`updateMemoryNode` 结束后异步写入
- **记忆注入**：以文字摘要形式追加到 generateTopicsNode 和 generateSummaryNode 的 prompt 上下文

### 关键数据结构

```
UserMemory
  userId          设备 ID
  gamesPlayed     游戏次数
  musicDNA        JSON { styles[], keywords[], songs[最近10首] }
  usedTopics      JSON string[]（用于过滤重复主题）

PairMemory
  pairId          SHA256(sorted(userIdA + userIdB))
  gamesPlayed     共同游戏次数
  gameHistory     JSON GameSnapshot[]（最近10局快照）
  relationTags    JSON string[]（累计关系标签）
  cumulativeMood  JSON string[]（累计氛围词）

GameReaction
  roomId / participantId
  accuracyVote    accurate | close | miss
  comment         最多100字
```

---

## 4. 功能 B：Agent 思考直播（已实现）

### 设计原则

- 前端轮询（3s 间隔）`/api/rooms/[roomId]` 的 `agentExecutionLog` 字段
- 维护"已展示数量"指针，每次只追加新条目，有逐条入场动画
- 每条日志标注节点名、类型（llm/tool/human/route）、耗时
- 游戏进行中显示"运行中"脉冲动画，结束后停止轮询

### 可视化目标

```
🤖 Agent 工作日志          [▼ 展开]
────────────────────────────────────
🗂️ 加载历史记忆         route  12ms
🧠 分析聊天内容         llm   1.2s
🧠 生成抽签主题         llm   0.9s
👤 等待双方抽签         human  ——
👤 等待双方选歌         human  ——
🧠 生成音乐总结         llm   2.1s
🔧 验证推荐歌曲         tool  0.4s
🗂️ 更新记忆档案         route  ——（异步）
```

---

## 5. 功能 C：AI 引导猜谜（V4 核心新增）

### 5.1 游戏流程

```
双方都提交歌曲，进入结果页
          ↓
[我的结果卡片：我的主题 + 我的歌]
[对方结果卡片：只看到歌，主题隐藏]
          ↓
「猜一猜」区域（独立 GuessChatGraph 驱动）
          ↓
AI 开场线索 → 用户猜 → AI 判断 → 提示/揭晓
（最多 3 次，也可随时放弃看答案）
          ↓
猜测结束后，对方主题揭晓，结果卡片完整展示
```

### 5.2 GuessChatGraph State 设计

```
GuessChatAnnotation:

  // 输入（固定）
  songName      string    对方选的歌
  artist        string    歌手
  topic         string    正确答案（AI 知道，用户不知道）
  maxAttempts   number    默认 3

  // 对话状态
  messages      Message[] 追加模式，完整对话历史
  attempts      number    已猜次数
  userGuess     string    当前轮用户输入的猜测词

  // AI 裁判结果
  verdict       "correct" | "close" | "wrong" | "pending"
  similarityScore number  Python 语义相似度得分（0-1）

  // 最终状态
  resolved      boolean
  finalReveal   string    揭晓文案
```

### 5.3 节点设计

#### generateHintNode（TypeScript）

- 输入：songName、artist、对话历史、attempts
- 职责：开场（attempts=0）或猜错后生成下一条提示
- Prompt 要点：
  - 开场：基于歌曲给一条隐晦线索，不超过 40 字，不直接说出主题词
  - 猜错后：结合上轮 verdict（close/wrong）给更有针对性的提示，温度感语言（"很接近了！""换个方向想想..."）
- 输出：追加一条 assistant 消息

#### judgeGuessNode（TypeScript 调用 Python 服务）

这是整个猜谜图最关键的节点，承担**双重裁判**职责：

**第一层：Python 语义相似度（快速、精确）**

在 `music-tool-server` 新增 `/judge-similarity` 端点：

```
POST /judge-similarity
Input:  { guess: string, answer: string }
Output: { score: float, level: "exact"|"close"|"related"|"far" }
```

Python 实现方案（`services/semantic.py`）：
- 使用 `sentence-transformers` 的中文模型（如 `paraphrase-multilingual-MiniLM-L12-v2`）计算向量余弦相似度
- 同时用 `rapidfuzz` 做字符串模糊匹配兜底
- 打分规则（可调）：
  - score > 0.85 → exact（猜对了）
  - score > 0.65 → close（很接近）
  - score > 0.45 → related（有相关性）
  - score ≤ 0.45 → far（方向偏了）

**第二层：LLM 语义兜底（处理歧义）**

当 Python 得分落在模糊区间（0.55-0.75）时，调用 LLM 做最终裁决：

```
System: 你是猜谜裁判。正确答案是"${topic}"，用户猜的是"${userGuess}"。
        Python 相似度得分：${score}（接近临界值）。
        综合语义和文化含义，判断是否算"猜对"？
        返回 JSON: { verdict: "correct"|"close"|"wrong", reason: string }
```

**组合判断逻辑**：

```
Python 得分 → "exact"  →  verdict = correct（跳过 LLM）
Python 得分 → "far"    →  verdict = wrong（跳过 LLM）
Python 得分 → "close"/"related" → 调用 LLM 做最终判断
```

这样大多数情况不消耗 LLM Token，只在模糊边界才调 LLM，兼顾速度和准确度。

#### routeAfterJudge（条件边）

```
correct                 → revealNode
close/wrong + attempts < maxAttempts → generateHintNode（循环）
close/wrong + attempts >= maxAttempts → revealNode（强制揭晓）
```

#### revealNode（TypeScript）

- 猜对时：生成庆祝文案，引用用户的猜测过程（"你从第X次提示里读出了..."）
- 猜错（超次数）时：温柔揭晓，用一句诗意文案连接两个主题
  - 例：答案是「公路」，你猜的是「夜晚」→ "其实夜晚和公路本来就在同一条路上"
- 输出写入 `finalReveal`，同时写入 `Participant.guessCorrect`

### 5.4 API 设计

**启动猜谜图**

```
POST /api/rooms/[roomId]/guess-chat/start
Body: { participantId, sessionToken }

→ 初始化 GuessChatGraph，传入对方的 songName/artist/topic
→ 图运行到第一个 interrupt（generateHintNode 完成后）
→ 返回 { threadId, firstHint: string }
```

**提交猜测（resume 图）**

```
POST /api/rooms/[roomId]/guess-chat/guess
Body: { participantId, sessionToken, guess: string, threadId: string }

→ resume GuessChatGraph，注入 { guess }
→ 图运行到下一个 interrupt 或 END
→ 返回 {
    reply: string,          AI 回复
    verdict: string,        correct/close/wrong
    resolved: boolean,      是否猜测结束
    answer?: string,        resolved=true 时揭晓
    finalReveal?: string    resolved=true 时的揭晓文案
  }
```

**放弃猜测**

```
POST /api/rooms/[roomId]/guess-chat/reveal
Body: { participantId, sessionToken, threadId }

→ 直接跳到 revealNode，强制揭晓
→ 返回 { answer: string, finalReveal: string }
```

### 5.5 前端 UI 设计

**猜谜区域（替换原有简单输入框）**

```
┌──────────────────────────────────────────┐
│  猜一猜 🎯                               │
│  对方选了《追光者》- 岑宁儿               │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │ 🤖 这首歌里有都市夜晚的气息，      │   │  ← AI 线索气泡
│  │    副歌有一种追逐感...             │   │
│  └──────────────────────────────────┘   │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │ 输入你的猜测...           [提交]  │   │
│  └──────────────────────────────────┘   │
│  还剩 2 次机会   [放弃，直接看答案]     │
└──────────────────────────────────────────┘
```

**猜测进行中的对话流**

```
┌──────────────────────────────────────────┐
│  🤖 ...（第一条线索）                    │
│                           你：「失恋」   │
│  🤖 方向偏了，这首歌其实更聚焦在           │
│     一个具体的场景里                      │
│                           你：「城市」   │
│  🤖 🎉 就是这个！「城市」！              │
│     你从第二条提示里读出了               │
│     那种都市追逐的感觉                   │
└──────────────────────────────────────────┘
```

**执行日志（AgentThinkingLog 里展示猜谜过程）**

```
🧠 生成开场线索    llm    850ms
👤 等待猜测 #1    human   ——
🔧 Python 语义判断 tool   45ms   → score: 0.21 (far)
🧠 LLM 裁判       [跳过]
🧠 生成提示 #2    llm    720ms
👤 等待猜测 #2    human   ——
🔧 Python 语义判断 tool   38ms   → score: 0.89 (exact)
🧠 生成揭晓文案   llm    600ms
```

### 5.6 Python 微服务扩展（music-tool-server）

在现有 `music-tool-server` 新增模块：

**新增文件结构**

```
music-tool-server/
  services/
    semantic.py       ← 新增：语义相似度计算
  routers/
    judge.py          ← 新增：/judge-similarity 端点
  requirements.txt    ← 新增：sentence-transformers
```

**services/semantic.py 设计**

```python
# 使用多语言句向量模型
# 模型选型：paraphrase-multilingual-MiniLM-L12-v2（轻量，支持中文）
# 首次加载约 500ms，之后缓存

def compute_similarity(guess: str, answer: str) -> dict:
    # 1. 向量余弦相似度（主要判断）
    # 2. rapidfuzz 字符串比率（兜底）
    # 3. 返回 score + level
    pass
```

**部署注意点**

- `sentence-transformers` 首次加载模型耗时较长，需要在 Railway 上预热
- 模型文件约 400MB，需要配置足够的内存（建议 512MB+）
- 替代方案：如内存不足，可用 DeepSeek embedding API 替代本地模型

---

## 6. 功能 D：结果页留言（已实现）

### 设计原则

- 在 AI 总结展示后，允许每位玩家对总结投票（很准/有点像/没准）+ 留言最多 100 字
- 每人只能提交一次（防重复）
- 留言写入 `GameReaction` 表
- `accuracyVote` 在 `updateMemoryNode` 里写入 `PairMemory`，下局 AI 总结可引用

---

## 7. 功能 E：首页欢迎回来（已实现）

### 设计原则

- 首页加载时查询 `/api/memory/user?userId=xxx`
- 有游戏记录时展示蓝紫横幅：游戏次数、上次选歌、偏好风格
- 自动回填昵称

---

## 8. FullGameAnnotation 更新（V4 猜谜相关字段）

主游戏图的 state 不直接承载猜谜对话（猜谜图独立），但需要记录猜谜结果供揭晓展示和记忆更新使用：

```
新增字段：
  guessResultA    { correct: boolean, attempts: number }
  guessResultB    { correct: boolean, attempts: number }
  
  （猜谜图结束后，由 /guess-chat/guess 路由写入数据库 Participant 字段，
   主游戏图通过 loadState 读取，不需要在主图 state 里传递）
```

---

## 9. 完整系统架构图（V4）

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js Frontend                            │
│  首页  →  房间页  →  抽签  →  提交歌曲  →  结果页  →  猜谜      │
└──────────────┬──────────────────────────────────────┬───────────┘
               │ API Routes                           │ API Routes
               ↓                                      ↓
┌──────────────────────────┐          ┌───────────────────────────┐
│   MainGameGraph          │          │   GuessChatGraph          │
│   (LangGraph TS)         │          │   (LangGraph TS)          │
│                          │          │                           │
│  loadMemory              │          │  generateHint             │
│  analyzeChat             │          │  ← interrupt →            │
│  generateTopics          │          │  judgeGuess               │
│  ← interrupt → draw      │          │  ← 条件循环 →             │
│  ← interrupt → entries   │          │  reveal                   │
│  generateSummary         │          │                           │
│  updateMemory            │          │  thread: inviteCode       │
│                          │          │         _guess_participantId│
│  thread: inviteCode      │          └──────────────┬────────────┘
└────────────┬─────────────┘                         │
             │                                       │ 调用
             ↓                                       ↓
┌────────────────────────────────────────────────────────────────┐
│                  PostgresSaver (Neon PostgreSQL)               │
│  两张图共享同一个 checkpointer，thread 隔离互不干扰             │
└────────────────────────────────────────────────────────────────┘
             │ Tool Call                             │ HTTP
             ↓                                       ↓
┌────────────────────────────────────────────────────────────────┐
│               Python FastAPI (music-tool-server)               │
│                                                                │
│  /search           网易云歌曲搜索                               │
│  /verify           歌曲验证 + rapidfuzz 模糊匹配                │
│  /judge-similarity 语义相似度（sentence-transformers）← V4新增  │
└────────────────────────────────────────────────────────────────┘
```

---

## 10. 实现顺序

```
✅ Phase 1（已完成）：数据库 + 记忆 CRUD
   - UserMemory / PairMemory / GameReaction 表
   - lib/memory/ CRUD 函数

✅ Phase 2（已完成）：MainGameGraph 接入记忆
   - loadMemoryNode + updateMemoryNode
   - FullGameAnnotation 新增记忆字段

✅ Phase 3（已完成）：Agent 思考直播
   - AgentThinkingLog 组件（轮询 + 逐条动画）

✅ Phase 4（已完成，待优化）：基础互猜 + 留言
   - 简单字符串猜测 + guess API + reaction API
   - 对方主题猜测结果出来前隐藏

✅ Phase 5（已完成）：AI 总结分离
   - entries 快速返回 + /summarize 独立路由（maxDuration=60）

────────── 下阶段开发 ──────────

Phase 6：Python 语义裁判服务
   - music-tool-server 新增 services/semantic.py
   - sentence-transformers 中文模型集成
   - /judge-similarity 端点
   - Railway 部署 + 内存配置

Phase 7：GuessChatGraph 独立图（TypeScript）
   - lib/agent/guessChatGraph.ts
   - GuessChatAnnotation 定义
   - generateHintNode / judgeGuessNode / revealNode
   - 条件路由（correct/close/wrong/maxAttempts）
   - 接入 PostgresSaver（独立 thread）

Phase 8：Guess Chat API 路由
   - /api/rooms/[roomId]/guess-chat/start
   - /api/rooms/[roomId]/guess-chat/guess
   - /api/rooms/[roomId]/guess-chat/reveal

Phase 9：前端猜谜对话 UI
   - 对话气泡组件（AI 线索 + 用户猜测历史）
   - 替换现有简单输入框
   - 放弃按钮 + 次数显示
   - 揭晓动画
   - 猜谜过程写入 AgentThinkingLog

Phase 10：端到端测试 + 记忆闭环验证
   - 连续两局游戏，验证记忆注入是否生效
   - 猜谜全流程测试（3轮猜测 + 放弃 + 正确）
   - Python 语义判断准确率验证
```

---

## 11. 技术风险与备选方案

| 风险 | 描述 | 备选方案 |
|------|------|---------|
| sentence-transformers 内存 | 模型约 400MB，Railway 免费版可能不够 | 用 DeepSeek Embedding API 替代本地模型 |
| GuessChatGraph 超时 | 3 轮猜测 = 最多 6 次 LLM 调用 + 3 次 interrupt，每次 resume 是独立请求，不存在超时 | 架构天然规避此问题 |
| Python 模型首次加载慢 | 冷启动约 5-10s | 在 start/guess-chat 路由加 Loading 态，或预热 |
| 跨图状态同步 | 猜谜结果需要回写到数据库，主游戏图不直接感知 | API 层写入 Participant 字段，前端轮询读取 |

---

## 12. 简历叙事升级（V4 完成后）

> **具备长期记忆的双人音乐 Agent**
>
> 基于 LangGraph HITL + PostgreSQL Checkpointer 构建。系统包含两张独立 LangGraph：主游戏图负责聊天分析、主题生成和音乐总结，猜谜图实现带条件循环的多轮 AI 主持对话（AI 同时扮演主持人和裁判，通过 Python sentence-transformers 语义相似度 + LLM 语义兜底完成猜测判断）。
>
> Agent 跨会话追踪用户音乐偏好 DNA，积累双人关系记忆，动态调整主题生成策略和总结风格。集成 Python FastAPI 工具层实现 Tool Use + ReAct 推荐验证。思考过程全程可视化，每个节点的耗时和判断结果实时推送到前端。
>
> 覆盖 Agent 核心能力：感知（聊天分析）、记忆（跨局 UserMemory/PairMemory）、规划（条件路由/循环图）、行动（Tool Use / Human-in-the-loop）、反思（语义裁判 + 动态提示生成）。
>
> **技术栈**：Next.js / TypeScript · LangGraph · PostgreSQL (Neon) · Python FastAPI · sentence-transformers · DeepSeek LLM
