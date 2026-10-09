-- Phase 12: Notification System Enhancements

-- Alter Notification Table
ALTER TABLE "Notification" 
  ALTER COLUMN "organizationId" SET NOT NULL,
  ADD COLUMN IF NOT EXISTS "actorId" UUID,
  ADD COLUMN IF NOT EXISTS "projectId" UUID,
  ADD COLUMN IF NOT EXISTS "taskId" UUID,
  ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Create Indexes
CREATE INDEX IF NOT EXISTS "Notification_actorId_idx" ON "Notification"("actorId");
CREATE INDEX IF NOT EXISTS "Notification_projectId_idx" ON "Notification"("projectId");
CREATE INDEX IF NOT EXISTS "Notification_taskId_idx" ON "Notification"("taskId");
CREATE INDEX IF NOT EXISTS "Notification_organizationId_userId_isRead_idx" ON "Notification"("organizationId", "userId", "isRead");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");

-- Foreign Key Constraints
ALTER TABLE "Notification" 
  ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
