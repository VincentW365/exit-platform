-- Runtime least-privilege grants (Directive 1.1 section C).
-- Run as exit_migrate (schema owner) against each project database AFTER
-- migrations: psql -U exit_migrate -d <db> -f scripts/db/grants.sql
-- Idempotent. Contains no secrets.
--
-- Model:
--   exit_admin   cluster superuser; setup/recovery only, never used by code.
--   exit_migrate owns the schema; applies migrations; runs integration-test
--                cleanup (TRUNCATE). Not used by web app or worker.
--   exit_app     runtime for web app + worker: SELECT/INSERT everywhere it
--                needs, UPDATE only where the domain permits mutation, and
--                NO DELETE, NO DDL, NO trigger control anywhere.

-- Start closed.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM exit_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM exit_app;

GRANT USAGE ON SCHEMA public TO exit_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO exit_app;

-- Mutable business tables: read, insert, update. Never delete.
GRANT SELECT, INSERT, UPDATE ON
  app_user,
  role_assignment,
  employee_source_record,
  offboarding_case,
  case_participant,
  attachment,
  baseline_event,
  holiday_calendar,
  holiday,
  reason_category,
  feature_flag,
  config_list_item,
  integration_placeholder,
  case_number_counter,
  document_template,
  document_instance,
  action_form_version,
  survey_template,
  survey_question,
  survey_invitation,
  render_job,
  workflow_definition,
  workflow_task_definition,
  workflow_instance,
  workflow_task,
  notification_template,
  notification_record,
  asset_catalogue_item,
  issued_asset,
  asset_recovery_item,
  handover_record,
  case_exception
TO exit_app;

-- Attestations: insert + read + update (update restricted by trigger to the
-- invalidation fields only; core columns are database-immutable).
GRANT SELECT, INSERT, UPDATE ON attestation TO exit_app;

-- Survey responses/answers: append-only evidence (no UPDATE, no DELETE).
GRANT SELECT, INSERT ON survey_response, survey_answer TO exit_app;

-- Stage 3 append-only evidence: clearance approvals, task corrections and
-- development notification captures can be written once, never changed.
GRANT SELECT, INSERT ON task_correction, clearance_record, notification_capture TO exit_app;

-- Append-only evidence: read and insert only. UPDATE/DELETE are refused at
-- the privilege layer (this file) AND by triggers (migration) - two
-- independent controls.
GRANT SELECT, INSERT ON
  audit_event,
  case_status_history,
  employee_snapshot,
  case_note
TO exit_app;

-- Prisma migration bookkeeping: runtime may read, never write.
GRANT SELECT ON "_prisma_migrations" TO exit_app;

-- Future tables created by exit_migrate default to read-only for exit_app;
-- write access must be granted deliberately per table in this file.
ALTER DEFAULT PRIVILEGES FOR ROLE exit_migrate IN SCHEMA public
  GRANT SELECT ON TABLES TO exit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE exit_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO exit_app;
