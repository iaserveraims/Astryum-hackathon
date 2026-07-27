-- V1.1 — FTSO delegate / undelegate / claimRewards support
-- Extends IntentAction enum for FTSOAdapter (capabilities: ftso_delegate, ftso_claim_rewards).
-- Postgres requires ALTER TYPE ADD VALUE per value.

ALTER TYPE "IntentAction" ADD VALUE IF NOT EXISTS 'delegate';
ALTER TYPE "IntentAction" ADD VALUE IF NOT EXISTS 'undelegate';
ALTER TYPE "IntentAction" ADD VALUE IF NOT EXISTS 'claimRewards';
