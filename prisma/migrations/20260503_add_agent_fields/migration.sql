-- AlterTable: Add V2 Agent fields to Room table
ALTER TABLE "Room" ADD COLUMN "agentPhase" TEXT;
ALTER TABLE "Room" ADD COLUMN "agentPersonalityProfiles" TEXT;
ALTER TABLE "Room" ADD COLUMN "agentRelationship" TEXT;
ALTER TABLE "Room" ADD COLUMN "agentNextSong" TEXT;
ALTER TABLE "Room" ADD COLUMN "agentExecutionLog" TEXT;
