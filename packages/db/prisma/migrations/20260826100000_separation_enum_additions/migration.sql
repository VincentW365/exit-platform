-- Canonical separation model, part 1 of 2 (owner directive, 2026-08-26).
--
-- PostgreSQL will not let a new enum value be used in the same transaction
-- that adds it, so the values land in their own migration ahead of the
-- columns and backfill that reference them.
--
-- Nothing existing changes: the three original values keep their names and
-- every stored case keeps its type. No record is reinterpreted.
ALTER TYPE "DepartureType" ADD VALUE IF NOT EXISTS 'RETIREMENT';
ALTER TYPE "DepartureType" ADD VALUE IF NOT EXISTS 'CONTRACT_EXPIRY';
ALTER TYPE "DepartureType" ADD VALUE IF NOT EXISTS 'REDUNDANCY';
ALTER TYPE "DepartureType" ADD VALUE IF NOT EXISTS 'OTHER';
