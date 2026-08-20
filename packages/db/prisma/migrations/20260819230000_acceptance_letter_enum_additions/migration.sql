-- Resignation acceptance letter issued by email (DEC-054).
-- Separate migration: Postgres cannot use a newly added enum value in the
-- transaction that adds it.
ALTER TYPE "IssueMethod" ADD VALUE 'EMAIL';
ALTER TYPE "DocumentStatus" ADD VALUE 'ISSUED_BY_EMAIL';
ALTER TYPE "NotificationType" ADD VALUE 'RESIGNATION_ACCEPTANCE_LETTER';
