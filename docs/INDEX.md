# Documentation Index

**Baseline version:** 0.1
**Date:** 2026-07-28

| Area | File | Purpose |
| --- | --- | --- |
| Top level | `README.md` | Package purpose, authority and usage. |
| Top level | `Project.md` | Project charter, scope, objectives and governance. |
| Top level | `CLAUDE.md` | Mandatory implementation-agent controls. |
| Top level | `START_HERE_FOR_CLAUDE.md` | Initial validation prompt. |
| Top level | `PACKAGE_MANIFEST.md` | File inventory, checksums and package QA summary. |
| Source | `docs/source/DMAIC_Source_Analysis.md` | Detailed analysis, strengths, contradictions and gaps. |
| Source | `docs/source/SourceReferences.md` | Official standards and integration references reviewed for this baseline. |
| Requirements | `docs/requirements/PRD.md` | Product requirements document. |
| Requirements | `docs/requirements/ScopeAndAssumptions.md` | In-scope, out-of-scope, assumptions and constraints. |
| Requirements | `docs/requirements/Glossary.md` | Controlled product and process terminology. |
| Requirements | `docs/requirements/BusinessRules.md` | Precise business and control rules. |
| Requirements | `docs/requirements/RequirementsCatalogue.md` | 313 stable requirements. |
| Requirements | `docs/requirements/RequirementsTraceabilityMatrix.md` | Source, phase, status and verification mapping. |
| Requirements | `docs/requirements/UserStoriesAndAcceptanceCriteria.md` | 40 user stories with testable criteria. |
| Requirements | `docs/requirements/DecisionRegister.md` | 35 decisions and approval owners. |
| Requirements | `docs/requirements/RolesAndPermissions.md` | Least-privilege role model. |
| Requirements | `docs/requirements/MetricsDictionary.md` | 13 defined KPIs. |
| Requirements | `docs/requirements/DataDictionary.md` | Core fields, source and classification. |
| Requirements | `docs/requirements/StakeholderApprovalChecklist.md` | Decisions required before each stage. |
| Requirements | `docs/requirements/Stage1ImplementationConstraints.md` | Reversible non-production Stage 1 constraints (IC-S1-001 to IC-S1-011). Not stakeholder approval. |
| Requirements | `docs/requirements/Stage2DocumentDecisionPack.md` | Approval-ready pack for DEC-004/005/007/010/025 (Directive 1.2; proposals only). |
| Requirements | `docs/requirements/Stage2ApprovalWorksheet.md` | Stage 2 approval capture worksheet (18 rows; blank until the meeting). |
| Templates | `docs/templates/ControlledDocumentCatalogue.md` | Stage 2 controlled document types DOC-01..05 (proposed). |
| Templates | `docs/templates/DocumentFieldDictionary.md` | Canonical Stage 2 document fields, sources and control rules (proposed). |
| Templates | `docs/templates/ResignationDocumentSpecification.md` | Section-level specs for the two resignation letters (no final wording). |
| Templates | `docs/templates/EmployeeActionFormOffboardingSpecification.md` | Offboarding action-form structure, exclusions and confirmation questions. |
| Templates | `docs/templates/DocumentLifecycleAndApprovalSpecification.md` | Proposed template/instance lifecycles and approval binding rules. |
| Templates | `docs/templates/DocumentOutputSpecification.md` | Output-format options, rendering standard and branding rules (proposed). |
| Delivery | `docs/delivery/Stage2DocumentReadinessReport.md` | Directive 1.2 readiness verdict and exact Directive 2 preconditions. |
| Delivery | `docs/delivery/Stage2CombinedBuildRecord.md` | Directive 2 build record: documents, action form, exit surveys. |
| Delivery | `docs/delivery/Stage3OperationalWorkflowBuildRecord.md` | Directive 3 build record: workflows, queues, access control, notifications, assets, handover, clearance. |
| Delivery | `docs/delivery/Stage4ProductionReadinessBuildRecord.md` | Directive 4 build record: outbox, adapters, pilot operations, reporting, privacy, packaging. |
| Delivery | `docs/delivery/SyntheticUATReport.md` | Directive 5 synthetic UAT execution: scenarios, defects, fixes, perf smoke, recommendation. |
| Delivery | `docs/delivery/BambooHRAndBrandingBuildRecord.md` | Directive 5.1: read-only BambooHR directory, real-data safeguards, approved branding. |
| Delivery | `docs/delivery/StakeholderUATGuide.md` | Directive 6: stakeholder access, scenario dataset, live-demo procedure, questionnaire. |
| Delivery | `docs/delivery/UATQuickStart.md` | Plain-language stakeholder walkthrough of the UAT scenarios (start here as a tester). |
| Delivery | `docs/delivery/StakeholderSyntheticUATReport.md` | Directive 6: stakeholder UAT capture record (pending stakeholder execution). |
| Delivery | `docs/delivery/RealisticUATDesignBuildRecord.md` | Directive 6.1 build record: organization routing, Audit Centre, realistic UAT design, UI refinement. |
| Delivery | `docs/delivery/LiveDataOperationalUATBuildRecord.md` | Directive 6.2 build record: live-data UAT, six-role model, role mapping, workflow effectiveness. |
| Delivery | `docs/delivery/OperationalEffectivenessReview.md` | Directive 6.2: prioritized operational-inefficiency findings (P0-P4) with implementation status. |
| Delivery | `docs/delivery/EndToEndLogicReview.md` | Directive 6.3 section-A logic audit: 22 classified findings with impact and disposition. |
| Delivery | `docs/delivery/HRValidatedWorkflowRedesign.md` | Directive 6.3 design record: operating model, data model, state machines, send controls, tokens, deferrals. |
| Delivery | `docs/delivery/Directive63BuildRecord.md` | Directive 6.3 build record: scope, changes by layer, migrations, security/privacy, deferrals. |
| Operations | `docs/operations/LiveDataStakeholderUATWalkthrough.md` | Directive 6.3 / DEC-043: 20-part live-data stakeholder UAT walkthrough (email-first model, no IT/Finance logins). |
| Operations | `docs/operations/HRDailyOffboardingWalkthrough.md` | Directive 6.3: step-by-step HR daily-use flow (review, exceptions, control - the platform does the routine work). |
| Operations | `docs/operations/RealisticStakeholderUATWalkthrough.md` | RETIRED (DEC-043) - pointer to the live-data walkthrough. |
| Operations | `docs/operations/RealisticUATAssignmentMatrix.md` | Directive 6.1 (superseded by the live-data walkthrough): alias/scenario/routing matrix. |
| Architecture | `docs/architecture/Architecture.md` | System context and modular-monolith design. |
| Architecture | `docs/architecture/DomainModel.md` | Domain boundaries and invariants. |
| Architecture | `docs/architecture/DataModel.md` | Proposed logical entities and relationships. |
| Architecture | `docs/architecture/StateMachines.md` | Case, task, document, notification, asset and survey states. |
| Architecture | `docs/architecture/WorkflowDesign.md` | Three workflow templates and due-date rules. |
| Architecture | `docs/architecture/IntegrationStrategy.md` | BambooHR, email, identity and storage boundaries. |
| Architecture | `docs/architecture/DocumentAndNotificationDesign.md` | Controlled generation, approval and outbox design. |
| Architecture | `docs/architecture/ArchitectureDecisionRecords.md` | Key design decisions and consequences. |
| Architecture | `docs/architecture/AuditEventCatalogue.md` | Required business/audit events. |
| Security | `docs/security/SecurityAndPrivacy.md` | Security and privacy baseline. |
| Security | `docs/security/ThreatModel.md` | Assets, trust boundaries, threats and mitigations. |
| Security | `docs/security/DataClassificationAndRetention.md` | Classification, retention capability and handling. |
| Security | `docs/security/SecurityVerificationChecklist.md` | Release security evidence checklist. |
| UX | `docs/ux/InformationArchitecture.md` | Navigation and role-based information structure. |
| UX | `docs/ux/ScreenInventory.md` | Screen purposes, users and actions. |
| UX | `docs/ux/TextWireframes.md` | Textual wireframes for core flows. |
| UX | `docs/ux/DesignSystemAndAccessibility.md` | Professional Bert's-style and WCAG requirements. |
| Delivery | `docs/delivery/Roadmap.md` | Bounded delivery stages and gates. |
| Delivery | `docs/delivery/TestStrategy.md` | Testing model and stage gates. |
| Delivery | `docs/delivery/RiskRegister.md` | 35 product/project risks. |
| Delivery | `docs/delivery/PilotAndRolloutPlan.md` | Baseline, pilot, rollout and adoption. |
| Delivery | `docs/delivery/ChangeControl.md` | Scope and decision change process. |
| Delivery | `docs/delivery/DefinitionOfDone.md` | Completion evidence per work item/stage. |
| Delivery | `docs/delivery/ClaudeBuildDirectives.md` | Paste-ready bounded implementation directives. |
| Delivery | `docs/delivery/BaselineValidationReport.md` | Directive 0 validation result, blockers and Directive 1 readiness. |
| Delivery | `docs/delivery/Stage1BuildRecord.md` | Directive 1 build record: versions, design decisions, evidence. |
| Delivery | `docs/delivery/Stage1AcceptanceReport.md` | Directive 1.1 acceptance audit: hardening, authorization matrix, visual QA. |
| Top level | `DEVELOPMENT.md` | Local development setup and check commands. |
| Operations | `docs/operations/ManualFallbackAndBusinessContinuity.md` | Secure fallback procedures. |
| Operations | `docs/operations/SupportAndIncidentManagement.md` | Ownership, incidents and support. |
| Operations | `docs/operations/BaselineDataCapturePlan.md` | Clean 4–6 week baseline capture. |
| Operations | `docs/operations/PilotRunbook.md` | Activation states, readiness gates, approvals and suspension procedure. |
| Operations | `docs/operations/ManualFallbackRunbook.md` | Executable outage/fallback/reconciliation procedure (`/continuity`). |
| Operations | `docs/operations/BackupRestoreRunbook.md` | Backup, checksum and isolated restore-verification procedure. |
| Operations | `docs/operations/SupportAndIncidentRunbook.md` | Ticket intake, triage, diagnostic bundles and incident handling. |
| Operations | `docs/operations/ProductionConfigurationChecklist.md` | Fail-closed production configuration gates (nothing satisfied yet). |
| Operations | `docs/operations/UATPlan.md` | Synthetic user acceptance test plan and sign-off rules. |
| Operations | `docs/operations/TrainingGuide.md` | Role-based training modules with recorded completions. |
| Operations | `docs/operations/ReleaseChecklist.md` | Per-release and pre-pilot promotion gates. |
| Operations | `docs/operations/OwnerTestingGuide.md` | Owner's full-operation testing guide: sign-in, daily flow, exception paths, environment health. |
| Operations | `docs/operations/LanAccessForInternalUAT.md` | LAN access for a tester on another workstation: start, Windows Firewall rule (manual, scoped), email-link base URL, second-machine verification, layer-by-layer diagnosis, remaining security considerations. |
| Operations | `docs/operations/Test-ExitPlatformLAN.ps1` | The tester's single action: run on their PC; picks the host address on their subnet, tests TCP/HTTP/app health, prints a verdict and the failing layer, saves a report to send back. No development tools needed. |
| Operations | `scripts/diagnose-lan-access.ps1` | Host-side PASS/WARN/FAIL LAN diagnostic: bind, adapter state (dead addresses flagged), routes and metrics, profiles, firewall state, config, local health, endpoint security. Read-only. |
| Operations | `scripts/firewall-lan-diagnostic.ps1` | Elevated Windows Firewall diagnostic for the port: inspect and flag misconfigured rules, temporary any-remote Domain rule with logging (recorded, revertible), permanent tester-scoped rule. Never silent. |
| Templates | `docs/templates/TemplateCatalogue.md` | Controlled document/notification inventory. |
| Templates | `docs/templates/ControlledCommunicationTemplates.md` | Sanitized draft templates and placeholders. |
| Templates | `docs/templates/ExitSurveySpecification.md` | Survey questions, privacy and token flow. |
| Templates | `docs/templates/AssetRecoverySpecification.md` | Asset checklist/disposition design. |
| Templates | `docs/templates/HandoverSpecification.md` | Knowledge-transfer checklist design. |

## Reading paths

### Sponsor and HR approval

1. `source/DMAIC_Source_Analysis.md`
2. `requirements/PRD.md`
3. `requirements/DecisionRegister.md`
4. `requirements/StakeholderApprovalChecklist.md`
5. `delivery/Roadmap.md`
6. `delivery/PilotAndRolloutPlan.md`

### Claude implementation

1. `../CLAUDE.md`
2. `requirements/RequirementsCatalogue.md`
3. `requirements/BusinessRules.md`
4. `architecture/StateMachines.md`
5. `architecture/WorkflowDesign.md`
6. `security/SecurityAndPrivacy.md`
7. active directive in `delivery/ClaudeBuildDirectives.md`

### Security and privacy review

1. `security/SecurityAndPrivacy.md`
2. `security/ThreatModel.md`
3. `security/DataClassificationAndRetention.md`
4. `security/SecurityVerificationChecklist.md`
5. `architecture/IntegrationStrategy.md`
6. `requirements/RolesAndPermissions.md`

## Change discipline

Do not update a requirement, decision, metric or workflow in isolation. Changes must preserve traceability across the catalogue, business rules, state/workflow design, acceptance criteria, tests and decision register.
