-- V4 Memory System Migration

-- Room 表新增记忆字段
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "userIdA" TEXT;
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "userIdB" TEXT;
ALTER TABLE "Room" ADD COLUMN IF NOT EXISTS "pairId"  TEXT;

-- Participant 表新增互猜字段
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "guess"        TEXT;
ALTER TABLE "Participant" ADD COLUMN IF NOT EXISTS "guessCorrect" BOOLEAN;

-- 新增 UserMemory 表
CREATE TABLE IF NOT EXISTS "UserMemory" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
  "nickname"    TEXT,
  "musicDNA"    TEXT,
  "usedTopics"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserMemory_userId_key" UNIQUE ("userId")
);

-- 新增 PairMemory 表
CREATE TABLE IF NOT EXISTS "PairMemory" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "pairId"         TEXT NOT NULL,
  "gamesPlayed"    INTEGER NOT NULL DEFAULT 0,
  "gameHistory"    TEXT,
  "relationTags"   TEXT,
  "cumulativeMood" TEXT,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PairMemory_pairId_key" UNIQUE ("pairId")
);

-- 新增 GameReaction 表
CREATE TABLE IF NOT EXISTS "GameReaction" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "roomId"        TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "userId"        TEXT,
  "accuracyVote"  TEXT,
  "comment"       VARCHAR(100),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameReaction_roomId_fkey"        FOREIGN KEY ("roomId")        REFERENCES "Room"("id"),
  CONSTRAINT "GameReaction_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id")
);
