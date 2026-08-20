-- Token purpose for the no-login return-items checklist link.
-- Separate migration: Postgres cannot use a newly added enum value in the
-- transaction that adds it.
ALTER TYPE "TokenPurpose" ADD VALUE 'COMPLETE_RETURN_CHECKLIST';
