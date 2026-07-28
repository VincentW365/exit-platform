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
| Operations | `docs/operations/ManualFallbackAndBusinessContinuity.md` | Secure fallback procedures. |
| Operations | `docs/operations/SupportAndIncidentManagement.md` | Ownership, incidents and support. |
| Operations | `docs/operations/BaselineDataCapturePlan.md` | Clean 4–6 week baseline capture. |
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
