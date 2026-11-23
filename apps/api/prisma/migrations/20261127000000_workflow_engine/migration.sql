-- فاز ۸ / F8-T6: موتور گردش کار تأیید چندمرحله‌ای + امضای الکترونیکی

CREATE TABLE IF NOT EXISTS "workflow_defs" (
    "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
    "code"       TEXT           NOT NULL,
    "title"      TEXT           NOT NULL,
    "steps"      JSONB          NOT NULL,
    "version"    INTEGER        NOT NULL DEFAULT 1,
    "active"     BOOLEAN        NOT NULL DEFAULT true,
    "createdAt"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_defs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_defs_code_key" UNIQUE ("code")
);

CREATE TABLE IF NOT EXISTS "workflow_instances" (
    "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
    "defId"         UUID           NOT NULL,
    "entityType"    TEXT           NOT NULL,
    "entityId"      UUID           NOT NULL,
    "title"         TEXT           NOT NULL,
    "status"        TEXT           NOT NULL DEFAULT 'IN_PROGRESS',
    "currentStep"   INTEGER        NOT NULL DEFAULT 1,
    "initiatedById" UUID,
    "finishedAt"    TIMESTAMPTZ(3),
    "createdAt"     TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_instances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_instances_entityType_entityId_key" UNIQUE ("entityType", "entityId")
);

CREATE TABLE IF NOT EXISTS "workflow_actions" (
    "id"         UUID           NOT NULL DEFAULT gen_random_uuid(),
    "instanceId" UUID           NOT NULL,
    "stepNo"     INTEGER        NOT NULL,
    "action"     TEXT           NOT NULL,
    "actorId"    UUID,
    "actorName"  TEXT           NOT NULL DEFAULT '',
    "comment"    TEXT           NOT NULL DEFAULT '',
    "signature"  TEXT           NOT NULL,
    "prevHash"   TEXT           NOT NULL,
    "hash"       TEXT           NOT NULL,
    "at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workflow_instances_status_idx" ON "workflow_instances" ("status");
CREATE INDEX IF NOT EXISTS "workflow_actions_instanceId_stepNo_idx" ON "workflow_actions" ("instanceId", "stepNo");
