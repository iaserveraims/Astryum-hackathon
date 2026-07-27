-- CMF (CanonicalMoneyFlow) link — F1, estrategia conjunta.
-- N AutomationRules compiled from one canonical flow share its id (one rule per
-- CanonicalStep; backend/src/canonical/moneyflow/CanonicalEvmTranslator.ts).
-- Nullable: rules created directly (PROTECT/HARVEST templates, manual) carry no ref.

ALTER TABLE "automation_rules" ADD COLUMN "canonicalRef" TEXT;

CREATE INDEX "automation_rules_canonicalRef_idx" ON "automation_rules"("canonicalRef");
