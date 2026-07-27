-- MoneyFlows TTL (guardarraíl: caducidad obligatoria ≤90d + revocación, o no se
-- entrega). Nullable: filas legacy manual/template siguen sin caducidad; las
-- reglas de origen MoneyFlow (canonicalRef) y las de consejo reciben SIEMPRE un
-- expiresAt clampado server-side (routes/rules.ts). El tick desactiva la regla
-- caducada en vez de evaluarla (AutomationEngine).

ALTER TABLE "automation_rules" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Governed MoneyFlows: cuando una regla de consejo dispara, el run registra
-- 'proposal_created' — la propuesta queda en la bandeja y la firma el quórum.
-- (PG ≥12 permite ADD VALUE dentro de la transacción de la migración mientras
-- el valor no se use en la misma transacción — aquí no se usa.)
ALTER TYPE "AutomationRunStatus" ADD VALUE 'proposal_created';
