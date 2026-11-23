-- موج ۵ — فاز ۱۲ (F12-T4): API Marketplace
CREATE TABLE "api_clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 60,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_clients_keyPrefix_key" ON "api_clients"("keyPrefix");
