-- G3 (auditoría 2026-08-17) — "la ocurrencia quemada".
--
-- `lastTriggeredAt` served TWO masters: the DB cooldown (AutomationEngine.tick,
-- `cooldownMinutes` guard) AND the cron occurrence marker (TriggerEvaluator,
-- TIME_TRIGGER: `due <= lastTriggeredAt` ⇒ already done). Since the engine
-- stamped it on EVERY fire — errors and busy-council included — a monthly
-- payment whose fire failed was recorded as done and NEVER retried: that
-- month's payment silently did not happen while the surface kept saying
-- "watching". Releasing the stamp is not the fix (the cooldown would go with
-- it and the rule would alert every 60s); the two uses are split instead.
--
-- `lastArtefactAt` is stamped ONLY when the fire produced its artefact
-- (council proposal, prepared intent, actionable nudge). `lastTriggeredAt`
-- stays as the pure cooldown stamp.

ALTER TABLE "automation_rules" ADD COLUMN "lastArtefactAt" TIMESTAMP(3);

-- Backfill: for existing rows `lastTriggeredAt` WAS the occurrence marker, so
-- copying it keeps their calendar exactly where it is. Without this, every
-- live TIME_TRIGGER rule would see its last occurrence as unconsumed on the
-- first tick after deploy and fire a duplicate nudge for a month already
-- served. Rows that never fired keep NULL (never fired, nothing consumed).
UPDATE "automation_rules"
SET "lastArtefactAt" = "lastTriggeredAt"
WHERE "lastTriggeredAt" IS NOT NULL;
