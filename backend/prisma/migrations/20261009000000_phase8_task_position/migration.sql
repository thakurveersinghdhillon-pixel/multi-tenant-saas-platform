-- AlterTable
ALTER TABLE "Task" ADD COLUMN "position" DOUBLE PRECISION NOT NULL DEFAULT 1000;

-- CreateIndex
CREATE INDEX "Task_projectId_status_position_idx" ON "Task"("projectId", "status", "position");
