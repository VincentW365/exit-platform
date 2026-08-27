# Design System and Accessibility

## 1. Visual direction

Create a professional internal enterprise application inspired by Bert's branding without copying the rough source dashboard.

### Recommended character

- light, clean working canvas;
- navy primary navigation/header;
- medium blue for interactive accents;
- yellow used sparingly for brand/high-attention accents;
- neutral grey surfaces and borders;
- red/orange only for error/urgency with text/icon labels;
- generous spacing;
- strong status hierarchy;
- restrained automotive/service-centre cues, not decorative clutter.

No status may rely on colour alone.

## 2. Suggested token direction

Final values require visual testing and contrast validation.

```text
brand.navy        deep navy
brand.blue        accessible interactive blue
brand.yellow      accent, not body text on white without contrast check
surface.canvas    near-white
surface.panel     white
surface.muted     light neutral
text.primary      near-black/navy
text.secondary    dark neutral
border.default    neutral
status.success    accessible green + icon/text
status.warning    accessible amber + icon/text
status.danger     accessible red + icon/text
focus.ring        high-contrast visible ring
```

Do not hard-code colours throughout components; use semantic tokens.

## 3. Typography

- professional system or approved corporate sans-serif;
- body approximately 16 px equivalent;
- compact data tables may use 14 px only when still readable;
- clear heading hierarchy;
- tabular numerals for dates/times/metrics where helpful;
- no all-caps paragraphs;
- labels remain visible, not placeholder-only.

## 4. Layout

- desktop-first for internal operations but responsive;
- content max widths appropriate to forms/readability;
- persistent side navigation on wide screens, accessible drawer on small screens;
- case summary stays visible near top;
- avoid excessive card nesting;
- tables switch to stacked records or horizontal scroll with context on small screens;
- survey optimized for mobile and one-question/short-section flow as needed.

## 5. Components

Required accessible components:

- button variants;
- links;
- text/date/time/select/combobox;
- employee search;
- status badge with icon/text;
- confidentiality banner;
- KPI card with numerator/denominator;
- data table with sortable headers and accessible captions;
- filter bar and active filter chips;
- timeline/task list;
- alert/exception panel;
- modal/dialog only for short high-risk confirmations;
- drawer only when focus management is correct;
- tabs with keyboard support;
- stepper;
- file upload with scan status;
- document preview fallback/download;
- toast plus persistent error summary;
- empty/loading/skeleton states;
- pagination;
- confirmation/attestation checkbox;
- chart with table/text alternative.

## 6. WCAG 2.2 Level AA target

### Keyboard and focus

- all actions operable without mouse;
- logical focus order;
- visible focus indicator not clipped;
- focus moves to error summary/dialog heading when appropriate;
- no keyboard trap;
- skip link/main landmark;
- sticky elements do not obscure focus.

### Forms

- persistent labels;
- instructions before controls;
- required fields clearly identified in text;
- programmatic error associations;
- error summary links to fields;
- date/time formats explained;
- autocomplete attributes used appropriately;
- destructive/high-impact actions require clear confirmation;
- do not require re-entering information already available without reason.

### Authentication/security

- avoid inaccessible CAPTCHA;
- allow password managers only if local credentials ever exist (not planned);
- session timeout warning with extension option where policy permits;
- high-risk re-auth flow accessible.

### Colour and content

- contrast validated;
- status has icon/label, not colour only;
- charts have data tables/text;
- plain language;
- abbreviations expanded;
- urgency communicated without flashing;
- target sizes and spacing suitable for pointer/mobile.

### Survey

- mobile reflow at 320 CSS px;
- zoom to 200/400% without loss;
- question groups use fieldset/legend;
- rating scale labels clear;
- character count announced appropriately;
- review before submit;
- expired/invalid messages reveal no case details.

## 7. Dates and times

Display:

```text
14 Aug 2026, 5:00 PM
America/Jamaica
```

For exact security deadlines, include timezone context and “Exact” label. Store UTC internally.

Avoid ambiguous numeric-only dates in employee-facing documents unless the controlled template requires them.

## 8. Status and urgency language

Example:

```text
URGENT — access removal due now
OVERDUE — due 18 minutes ago
DUE SOON — due in 2 hours
BLOCKED — awaiting verified personal email
SUBMITTED — provider accepted; delivery not confirmed
```

## 9. Confidentiality UX

- restricted banner at top of case/document/response;
- do not show sensitive preview in notifications/toasts;
- prevent browser page title from containing sensitive termination detail;
- confirm before restricted export/download;
- mask personal email and sensitive values by default where practical;
- no PII in URL;
- timeout/logout returns to non-disclosing page.

## 10. Content style

Use direct action language:

- “Approve and issue letter”
- “Record asset disposition”
- “Block task”
- “Return for correction”
- “Provider accepted; delivery not confirmed”

Avoid:

- “Process”
- “Done”
- “AI sent”
- “Completed” when only queued/submitted
- vague error messages without next action.

## 11. Accessibility evidence

Each major stage should include:

- automated axe or equivalent checks;
- keyboard walkthrough;
- screen-reader spot checks;
- contrast review;
- mobile/zoom review;
- form error tests;
- chart alternative verification;
- documented exceptions and remediation.

## 12. Implementation record

Where the required components above actually live, so a change to one can be
traced back to the rule it satisfies. The design system is a single
stylesheet layered over the base one: `apps/web/src/app/globals.css` holds
the foundation (tokens, reset, base controls) and
`apps/web/src/app/design-system.css` loads after it and holds the numbered
sections of the owner design directive.

| Component (section 5) | Implementation |
| --- | --- |
| Section headers, entity rows, KPI blocks, activity timeline | `components/patterns.tsx` — `SectionHead`, `Rows`/`Row`, `Kpi`, `Activity` |
| Filter bar and active filter chips | `app/(app)/cases/page.tsx`; values from `listCaseFilterOptions`; styles under design-system §15 |
| Form fields, grouping, required/optional, error state | `components/forms.tsx` — `FormSection`, `Field`, `FieldRow`, `FormActions`; styles §18 |
| Persistent error summary | `components/ErrorSummary.tsx` — takes focus when it appears |
| Modal/dialog for short high-risk confirmations | `components/ConfirmDialog.tsx` — native `<dialog>` + `showModal()`; styles §19 |
| Chart with table alternative | `components/ReportAnalytics.tsx` — CSS-drawn bars, `role="img"`, table beneath; styles §16 |
| Loading/skeleton states | `components/Skeleton.tsx` plus `loading.tsx` per route segment; styles §21 |
| Motion | design-system §22 — feedback only; the global `prefers-reduced-motion` rule in `globals.css` overrides all of it |
| Progressive step accordion | `components/StepAccordion.tsx` — case creation as steps that resolve and recede; styles §23 |

### Rules the implementation is held to

- A modal is used only for a short, high-risk confirmation, and it states the
  consequence before it asks for a reason. Selection forms (granting or
  revoking a role, choosing a recipient) stay on the page.
- A chart is drawn only where one measure varies across named groups. Summing
  a column whose name reads as a percentage, rate or duration is refused —
  those are averaged and labelled as averages.
- Filter values are read through the same record-level visibility clause as
  the rows, so a dropdown cannot disclose that a restricted case exists.
  Covered by `caseListFilters.test.ts`.
- Nothing animates on page load except a message that has just told the
  reader something.

### Responsive and accessibility evidence

- `e2e/responsive-sweep.spec.ts` — every rebuilt surface at 390px, 768px and
  1280px, asserting the document never scrolls sideways and that the
  navigation stays reachable at each width.
- `e2e/uat-visual.spec.ts` — tablet screenshots and axe sweeps of the
  role-representative surfaces.
- `e2e/confirm-dialog.spec.ts` — the destructive-action dialog states its
  consequence, can be dismissed by Escape or by an explicit way out, and
  still requires a reason.

## 13. The step accordion

Case creation is a sequence of decisions, not one long form. Each step
resolves into a one-line summary and moves out of the way; the next one
opens; nothing is ever hidden permanently.

### The rules it is held to

- **Collapsing is presentation only.** Every step's content stays mounted and
  every field keeps its value. A closed step is hidden with the `hidden`
  attribute, never unmounted, so collapsing can never cost a keystroke.
- **Completion is earned, not claimed.** A step resolves because its required
  fields hold values AND the reader has passed through it. Several fields
  arrive prefilled from the separation profile; counting a step the reader
  never opened would report progress they had not made. Empty a required
  field on a settled step and it returns to needing attention.
- **Active and attention are orthogonal.** "Active" says where the reader is;
  "attention" says what is missing. A step can be both, so an open step that
  has lost a required value still says so.
- **The accordion is not a form.** The first steps carry their own GET forms
  (choosing an employee, choosing a separation type) and a form cannot
  contain another. Later steps' fields join one form rendered beside the
  accordion through the HTML `form` attribute.
- **The server remains the authority.** The accordion is the reader's running
  account of where they are; whether the case is actually valid is decided by
  `separationErrors` on the server at creation, exactly as before.

### State, in three signals

Each state is carried by a mark, a word and a colour, so none of them is
load-bearing alone: a numbered circle and "Not started", a check and
"Complete", an exclamation and "Needs attention". The active step additionally
takes the accent edge and elevation so the reader can always answer "where am
I".

### Which steps exist

The step list is built from the separation profile, so it changes with the
way the employee is leaving: a termination has no notice step, "Other" gains
a step asking what the separation is, and a type with no authorizer to record
does not show that field at all. Covered by `e2e/case-wizard.spec.ts`.
