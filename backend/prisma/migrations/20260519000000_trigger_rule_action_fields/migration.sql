-- ============================================================================
-- Migration: trigger_rule_action_fields
-- Adds suggested action fields and lastProcessedBlock to trigger_rules.
-- These are additive nullable columns — safe with any existing data.
-- ============================================================================

-- Suggested action to offer the user when this rule fires.
-- Values: 'notify_only' | 'swap' | 'transfer' | 'moonpay_buy'
ALTER TABLE "trigger_rules"
    ADD COLUMN IF NOT EXISTS "suggestedActionType"   TEXT;

-- Action-specific parameters (e.g. { fromToken, toToken, amount } for swap).
ALTER TABLE "trigger_rules"
    ADD COLUMN IF NOT EXISTS "suggestedActionParams" JSONB;

-- Last block processed by OnchainEventEvaluator.
-- Prevents re-processing the same logs across evaluator ticks.
ALTER TABLE "trigger_rules"
    ADD COLUMN IF NOT EXISTS "lastProcessedBlock"    BIGINT;

-- Index to speed up lookup of onchain_event rules (polled every 60s).
CREATE INDEX IF NOT EXISTS "trigger_rules_conditionType_enabled_idx"
    ON "trigger_rules"("conditionType", "enabled");
