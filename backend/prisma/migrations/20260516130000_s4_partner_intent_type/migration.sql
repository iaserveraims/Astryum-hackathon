-- V1.1 S4 — Partner Intent + MoonPay
-- Additive: nullable column with default; existing rows backfill to 'buy'.

ALTER TABLE "partner_intents" ADD COLUMN "intentType" TEXT DEFAULT 'buy';
