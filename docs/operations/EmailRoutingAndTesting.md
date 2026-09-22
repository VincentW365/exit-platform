# Email Routing and Testing

How the platform decides who receives an offboarding email, and how to test the
whole workflow with a single mailbox before switching to the real organizational
addresses.

Approved under DEC-056. Related: DEC-047 (recipient directory), DEC-048 (no-login
links), DEC-055 (rehearsal mode).

## The rule

**No workflow, template or component names a mailbox.** A notification is
addressed to a **destination**; one routing table says what each destination
means; the recipient directory holds the address itself, encrypted and approved.

Moving Finance to a new mailbox, or copying Security on access removals, is a
change an administrator makes on screen. It is never a code change, and it never
requires a release.

## Destinations

**Static** destinations resolve to a configured mailbox in the recipient
directory. They are the shared inboxes a department reads:

| Destination | Reads from |
| --- | --- |
| Human Resources | `HR_OFFBOARDING` |
| HR Officers | `HR_OFFICERS` |
| Payroll | `PAYROLL` |
| Finance | `FINANCE_OFFBOARDING` |
| IT | `IT_OFFBOARDING` |
| Security | `SECURITY` |
| Asset / Warehouse | `ASSET_WAREHOUSE` |
| Group health provider | `SAGICOR_GROUP_HEALTH` |
| Group life provider | `NCB_GROUP_LIFE` |
| Payroll bank | `PAYROLL_BANK` |
| Pension provider | `PENSION_PROVIDER` |
| Other approved external party | `OTHER_APPROVED_EXTERNAL` |

**Dynamic** destinations resolve from the case, because the answer is different
for every employee. They cannot be a fixed mailbox:

| Destination | Resolves to |
| --- | --- |
| This employee's manager | The manager on the case, from the synchronized directory |
| The assigned HR Officer | The officer assigned to this case |
| The case owner | The owner of record |
| The departing employee | The employee's recorded email |

A destination that cannot be resolved is **reported, never skipped**: the case
raises an actionable "Recipient required" exception naming the destination that
failed. Nothing disappears quietly.

## Administration → Email Routing

For each notification type the HR Manager sets the primary recipient (To), any
copies (Cc), any blind copies (Bcc) and a note explaining the route. Held by the
HR Manager alone (`notifications.routing`, DEC-063): who receives which
notification is a business decision.

Every change is audited as `NOTIFICATION_ROUTING_CHANGED` with destination keys
and the actor — never addresses.

Blind copies are supported but deserve restraint: a person who cannot see who
else received a message cannot correct a mistake in it.

## The three environments

`APP_ENVIRONMENT` is separate from `NODE_ENV`, which governs how the application
is built and run.

| Environment | Recipients | Delivery |
| --- | --- | --- |
| `development` | Must be non-deliverable (`.test`, `.invalid`, `localhost`, `capture://`). A local mistake cannot reach a person even if every other guard failed. | Captured in the development mailbox. |
| `test` (UAT) | The **real** organizational addresses, resolved exactly as in production — because the point of UAT is to prove routing. | Every message is redirected to `TEST_EMAIL`. Redirection **cannot be turned off** here. |
| `production` | Real, deliverable addresses. | Real delivery. |

Two start-up guards make the promise keepable rather than aspirational:

- `APP_ENVIRONMENT=test` without `TEST_EMAIL` refuses to start. A test
  deployment with nowhere to redirect would deliver for real.
- `NODE_ENV=production` with any other `APP_ENVIRONMENT` refuses to start.
  Production must never quietly run as a redirected environment.

## Testing with one mailbox

Turn rehearsal mode on under **Administration → Email Delivery Status**, or
deploy with `APP_ENVIRONMENT=test`, and:

- the real To, Cc and Bcc are calculated normally by the routing rules;
- the message is delivered to the single test mailbox instead;
- the subject is prefixed `[TEST MODE]`;
- the body opens with the intended recipients **in full**, so the tester can
  check them against the routing table. A masked address cannot be verified,
  and the reader is the authorized tester;
- everything else is unchanged: same templates, rules, timing, attachments,
  records and evidence. The stored snapshot keeps the real message, so the
  record of what HR approved stays honest.

The audit trail and the email log keep masks throughout.

### Links inside captured mail, when the tester is on another workstation

The secure links in a message (exit checklist, acknowledgement) are built
from `APP_BASE_URL`. If that is `http://localhost:3000` and the tester opens
the captured message from their own workstation over the LAN, the link
points at *their* machine and dead-ends. Set `APP_BASE_URL` to the host's LAN
address before a LAN session and restart the web app **and** the worker; both
warn at startup while the value is still loopback. See
`LanAccessForInternalUAT.md`.

## Administration → Email Log

One row per message the platform tried to send:

date generated and sent · case and employee · notification type · intended
To/Cc/Bcc (masked) · the address actually used (masked) · subject · delivery
status and attempts · Test/Live indicator · error detail where a send failed.

Filterable by delivery status, case reference and test-only. Read with
`outbox.view` (HR Manager, DEC-063). It exists to answer *"did this
go to the right place"* — not to become a directory of everyone's email, which is
why the addresses stay masked even here.

## Switching to production mailboxes

1. Enter the real departmental addresses in **Administration → Recipient
   Directory** and take them through approval and verification.
2. Confirm each route under **Administration → Email Routing**.
3. Run the workflow in `test` and read the intended recipients in the redirected
   copies against the routing table.
4. Deploy with `APP_ENVIRONMENT=production`.

No application logic changes at any step.
