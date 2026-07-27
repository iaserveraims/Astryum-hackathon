-- P-AGENT-1: AI Agent System tables
-- AgentConversation, AgentMessage, AgentDocument, AgentRule,
-- UserMCPConnection, UserAnthropicKey

CREATE TABLE "agent_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mcpToolCalls" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_documents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user_upload',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerType" TEXT NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "prompt" TEXT NOT NULL,
    "outputChannel" TEXT NOT NULL DEFAULT 'both',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mcpServersReq" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastTriggeredAt" TIMESTAMP(3),

    CONSTRAINT "agent_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_mcp_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "serverName" TEXT NOT NULL,
    "serverUrl" TEXT,
    "apiKeyEnc" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_mcp_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_anthropic_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "user_anthropic_keys_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "agent_conversations_userId_updatedAt_idx" ON "agent_conversations"("userId", "updatedAt");
CREATE INDEX "agent_messages_conversationId_createdAt_idx" ON "agent_messages"("conversationId", "createdAt");
CREATE INDEX "agent_documents_userId_uploadedAt_idx" ON "agent_documents"("userId", "uploadedAt");
CREATE INDEX "agent_rules_userId_isActive_idx" ON "agent_rules"("userId", "isActive");
CREATE INDEX "user_mcp_connections_userId_isActive_idx" ON "user_mcp_connections"("userId", "isActive");

-- Unique constraints
CREATE UNIQUE INDEX "user_mcp_connections_userId_serverId_key" ON "user_mcp_connections"("userId", "serverId");
CREATE UNIQUE INDEX "user_anthropic_keys_userId_key" ON "user_anthropic_keys"("userId");

-- Foreign keys
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_rules" ADD CONSTRAINT "agent_rules_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_mcp_connections" ADD CONSTRAINT "user_mcp_connections_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_anthropic_keys" ADD CONSTRAINT "user_anthropic_keys_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
