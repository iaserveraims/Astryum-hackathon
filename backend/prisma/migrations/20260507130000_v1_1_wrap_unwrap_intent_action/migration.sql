-- V1.1 — WFLR wrap/unwrap support
-- Extends IntentAction enum with new values used by WFLRAdapter (capability: wrap_native).
-- Postgres requires ALTER TYPE ADD VALUE per value (cannot be wrapped in a transaction
-- with other DDL on the same enum, hence one statement per value).

ALTER TYPE "IntentAction" ADD VALUE IF NOT EXISTS 'wrap';
ALTER TYPE "IntentAction" ADD VALUE IF NOT EXISTS 'unwrap';
