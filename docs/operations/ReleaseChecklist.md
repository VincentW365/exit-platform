# Release Checklist

Gate list for promoting a build of the offboarding platform. Two levels:
**(A)** every release to any shared environment; **(B)** additionally before
first production/pilot activation. Evidence lives in the stage build record
and the directive evidence report; a passing build never overrides a failed
test or an unresolved security finding.

## A. Every release

- [ ] Working tree clean; release built from a committed state; no push
      without explicit authorization.
- [ ] `pnpm run format:check` passes.
- [ ] `pnpm run lint` passes.
- [ ] `pnpm run typecheck` (all packages, strict) passes.
- [ ] `pnpm run test` (unit, including the production fail-closed
      configuration matrix) passes.
- [ ] `pnpm run test:int` (integration, isolated test database) passes.
- [ ] `pnpm exec playwright test` (all E2E suites) passes.
- [ ] `pnpm --filter web run build` (production build) succeeds.
- [ ] `prisma migrate status` clean; migration-from-zero verified on a
      scratch database; `prisma migrate diff` shows no drift.
- [ ] `scripts/db/grants.sql` re-applied; runtime-privilege integration
      tests pass (no DELETE anywhere; append-only evidence intact).
- [ ] Fresh database backup taken and restore-verified.
- [ ] Secret/sensitive-data scan of the diff: no credentials, no real
      employee data, synthetic identities only.
- [ ] Accessibility sweep (axe critical/serious = 0) on changed surfaces;
      no horizontal overflow at 375px.
- [ ] Documentation updated for changed behaviour (build record, runbooks,
      traceability).

## B. Additionally before production/pilot activation

- [ ] Production Configuration Checklist complete (fail-closed matrix
      satisfied; secrets in the host secret manager as references).
- [ ] Container images built from the committed Dockerfiles, run as
      non-root, pass HEALTHCHECK, contain no secrets/DMAIC; image scan
      clean. (Not executable on the current workstation - Docker is not
      installed; must be run in CI or on the deployment host.)
- [ ] `/api/health` and `/api/ready` verified in the target environment;
      worker heartbeat visible.
- [ ] All 24 pilot readiness gates PASS; activation proposed and dually
      approved (HR Manager + System Administrator, plus Privacy Officer
      where configured); rollback plan recorded.
- [ ] UAT signed off (UATPlan.md) and training completions recorded. The
      automated synthetic execution (docs/delivery/SyntheticUATReport.md)
      supports but does not replace stakeholder sign-off.
- [ ] Manual fallback readiness confirmed (`readiness.manualFallbackReady`)
      with the runbook rehearsed once.
- [ ] Written authorizations on file for every live integration touched
      (email/Graph, identity, BambooHR, storage, scanner) - none exist
      today; the platform stays fail-closed without them.
- [ ] Retention/DSR decisions approved by the Privacy Officer (currently
      OPEN; development values are synthetic).
- [ ] Decision Register reviewed: no OPEN decision is silently assumed.
