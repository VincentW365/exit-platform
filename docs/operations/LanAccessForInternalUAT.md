# LAN Access for Internal UAT

How an authorized HR tester on another workstation reaches the platform
while it runs on the owner's machine (owner directive, 2026-09-02). Nothing
here is internet-facing: no router change, no port-forwarding, no public
address. The platform is reachable only on the company network, only while
the host is running it, and only through a firewall rule the host's
administrator creates.

## 1. What changed, and what deliberately did not

| | |
| --- | --- |
| Web server | Listens on `WEB_HOST`/`WEB_PORT` from `.env` (default `0.0.0.0:3000`). `pnpm dev` prints every reachable address; `pnpm dev:local` keeps it to this machine. |
| Email links | Built from `APP_BASE_URL`. For LAN testing it must be the host's LAN address, not `localhost` (section 4). |
| Sign-in page | States plainly when the server is reachable from the network and the role switcher needs no password. |
| Dev-origin protection | The Next.js *development* server refuses its own scripts and live-reload socket to browser origins it has not been told about, so a LAN page would render but never come alive. `next.config.ts` now allows this machine's own network addresses automatically at each start (self-healing when DHCP changes) plus any `DEV_ALLOWED_ORIGINS`. Production has no such guard; the allow-list is empty there. |
| Database | **Unchanged.** PostgreSQL listens on `127.0.0.1:5433` only (`postgresql.conf`, `pg_hba.conf`); no other workstation can connect to it. All data access goes through the application. |
| Authentication, sessions, roles, audit | **Unchanged.** The session cookie is host-scoped and `SameSite=Lax`; every read and mutation is authorized on the server; the audit trail records actions regardless of where the browser is. |
| CORS / CSP | **Unchanged.** The application has no separate API origin - server actions and route handlers are same-origin - and the Content-Security-Policy is entirely `'self'`, which is origin-relative and therefore correct on any address. |
| Hard-coded addresses | None in application code. The only loopback references are the `APP_BASE_URL` default and the rule that development email recipients must be non-deliverable. |

## 2. Start the stack

```powershell
pnpm dev       # prints Local, and LAN addresses with their interface names
pnpm worker    # in a second terminal
```

Read the LAN address from the `pnpm dev` banner **every time**. It comes
from the live network interfaces because a DHCP lease can change between
days; an address copied into a document goes stale.

If port 3000 is already taken by another project on this workstation, set
`WEB_PORT` in `.env` and restart. No code changes.

## 3. Windows Firewall - a manual step on the host

Windows blocks inbound connections to a new listening port by default, so a
second workstation will time out until the host's administrator allows it.
This is done **once**, in an **elevated** PowerShell, and it is the control
that decides who can reach the application:

```powershell
# Scoped to the Private and Domain profiles - never Public - and to ONE
# tester's address. Replace the port if WEB_PORT is not 3000 and the
# address with the tester's workstation.
New-NetFirewallRule -DisplayName "Exit Platform UAT (TCP 3000)" `
  -Direction Inbound -Protocol TCP -LocalPort 3000 `
  -Profile Private,Domain -Action Allow `
  -RemoteAddress 192.168.1.55
```

- Add more testers with additional `-RemoteAddress` values, or a single
  rule with a comma-separated list. Do not widen to `Any` unless every
  machine on the network is meant to reach a passwordless sign-in.
- Remove it when the UAT session is over:
  `Remove-NetFirewallRule -DisplayName "Exit Platform UAT (TCP 3000)"`.
- Check the network profile is not Public before creating the rule:
  `Get-NetConnectionProfile`. The rule above will not apply on a Public
  profile, which is the intended safety.

## 4. Email links on another workstation

The platform puts secure links in email - the exit checklist and the
acknowledgement links - and builds them from `APP_BASE_URL`. A link that
says `localhost` opened on the tester's workstation points at the tester's
own machine and dead-ends.

For LAN testing, set `APP_BASE_URL` in `.env` to the LAN address printed by
`pnpm dev` (for example `http://192.168.1.20:3000`) and restart **both** the
web app and the worker - the worker is what dispatches the email. `pnpm dev`
and the worker's startup log both warn when this is still `localhost` while
the server is network-reachable.

Email itself still never leaves the machine: the development capture
provider and the test-mode redirection are unaffected by where the browser
is. A tester reads captured messages under **Development → Mailbox** from
their own workstation, and the links inside open the host.

## 5. Verification from a second workstation - one action

Copy `docs/operations/Test-ExitPlatformLAN.ps1` to the tester's computer and
run it (right-click → *Run with PowerShell*). It needs no development tools.
It finds the tester's own address, picks the host address on the same
subnet, tests TCP, HTTP and the application's own health endpoint
(`/api/health/lan`), prints a plain verdict such as

```text
PASS - Exit Platform reachable at http://192.168.236.10:3010
```

or `FAIL - TCP connection never reached the application`, says which layer
it stopped at, and saves `ExitPlatformLAN-<timestamp>.json` and `.txt` on the
tester's Desktop. Send both files back to the host owner; they are enough to
finish the diagnosis without a second visit.

A request from the host to its own address is **never** counted as a
second-machine test - it is answered internally and proves nothing about the
network, the firewall or endpoint security.

The manual checklist below is what the script automates, kept for reference.

| Check | Expected |
| --- | --- |
| Open `http://<lan-address>:<port>/signin` | Sign-in page loads with the "Reachable from the network" note above the role buttons. |
| Sign in as HR Officer | Lands on Exit Center; the session persists across pages. |
| Cases → Create New Case → search the directory | Employee results load (BambooHR read-only directory, or the synthetic fixtures). |
| Create a draft, open it, edit a draft field, save | The case saves; Audit shows `CASE_CREATED` and `CASE_UPDATED`. |
| Complete a step, tick a checklist item, fill a form | Values persist after reload. |
| Upload an attachment, then download it | Both succeed; the download URL is the LAN address, not `localhost`. |
| Browser dev tools → Network | No request targets `localhost` or `127.0.0.1`; everything is same-origin. |
| Sign out, open a case URL directly | Redirected to sign-in. Sign in as a role without access to a restricted case and open it: denied. |
| Development → Mailbox, open a captured message with a link | The link opens on the host, not the tester's machine (requires section 4). |
| Stop and restart `pnpm dev` and `pnpm worker` | LAN access comes back with no code change. |

## 6. Security considerations that remain

- **The development role switcher is passwordless.** With `ALLOW_DEV_LOGIN=true`
  and the server reachable from the network, anyone who can open the address
  can sign in as any role, including HR Manager, and see whatever that role
  can see. An application-side IP allow-list was considered and rejected: the
  server can only see the client-supplied `X-Forwarded-For` header, which any
  client can set, so such a gate would be false assurance. The firewall
  rule's remote-address scope is the real control. Keep it narrow, and stop
  the server when the session ends.
- **Live directory data.** When the live BambooHR directory is connected,
  real names are visible to anyone who signs in. Treat the LAN URL as you
  would the data behind it: give it only to authorized HR testers.
- **Plain HTTP on the LAN.** Traffic between the tester and the host is not
  encrypted. That is acceptable on a trusted internal network for UAT and is
  not acceptable for production, which runs behind TLS with `Secure` cookies
  and HSTS (already configured for `NODE_ENV=production`).
- **This is not a deployment.** The host's workstation is the server; when
  it sleeps, locks its network or leaves the building, the platform is gone.
  Production hosting is a separate, gated decision (ProductionConfigurationChecklist.md).

## 7. Diagnosing a failed LAN test

Three scripts, each for one side of the problem. None changes anything
unless you name the change.

| Script | Where | What it does |
| --- | --- | --- |
| `scripts/diagnose-lan-access.ps1` | host, unelevated | PASS/WARN/FAIL report: listener and bind address, every IPv4 address with **adapter state** (a disconnected adapter's address is flagged dead), gateways and metrics, default-route count, host model, network profile, firewall profile state, rules for the port (needs elevation), `APP_BASE_URL`/`WEB_HOST`/`WEB_PORT`, local HTTP health, SentinelOne presence. Prints the only URLs safe to give a tester. |
| `docs/operations/Test-ExitPlatformLAN.ps1` | tester's PC | The single tester action (section 5). Saves a JSON + text report. |
| `scripts/firewall-lan-diagnostic.ps1` | host, **elevated** | `-Action Inspect` lists rules for the port and flags the classic mistakes (Private-only on a Domain machine, stale tester address, explicit Block, disabled). `-Action EnableDiagnostics` creates ONE clearly named TEMPORARY Allow rule (Domain, any remote) and turns on blocked-packet logging, recording the originals first. `-Action Revert` removes the rule and restores logging. `-Action CreateScopedRule -TesterIp <ip>` writes the permanent narrow rule. It never changes anything silently. |

The launcher banner (`pnpm dev`) now asks Windows which adapters are
actually connected and marks the rest as **dead**. Node reports every
address a machine *holds*, including one left on a disconnected Wi-Fi radio
by an old DHCP lease - the host can reach that address itself, and nobody
else can. That is exactly how the first LAN attempt failed: the advertised
address was on a Wi-Fi adapter that was not connected.

### Reading the tester's report - which layer failed

| Report says | Layer | Meaning | Next step |
| --- | --- | --- | --- |
| TCP never connected, tester on the **same** subnet | 2 or 5 | The packet reached the host's NIC and the host refused it: Windows Firewall scope, or SentinelOne Firewall Control | Elevated: `firewall-lan-diagnostic.ps1 -Action EnableDiagnostics`, rerun the tester script, read the log (below), then `-Action Revert` |
| TCP never connected, tester on a **different** subnet | 3 or 4 | Routing between subnets, VLAN ACL, or Wi-Fi client isolation - the host may never see the packet | Tester's `tracert` in the report shows where it dies; involve IT with the two addresses and the port |
| TCP connected, HTTP failed | 6 | Something answered the port but not as the app | Check `diagnose-lan-access.ps1` "Bind address" - is it *this* checkout? Read the host's `pnpm dev` output at that moment |
| HTTP 200 but health endpoint missing, or the page never comes alive in the browser | 7 | Wrong build, dev-origin guard, CSP, cookies | Browser F12 → Console/Network on the tester's PC; host log line `Blocked cross-origin request … from "<host>"` names the origin to allow |

**The decisive firewall test**, in the elevated diagnostic window: after the
tester reruns their script,

```powershell
Get-Content "$env:SystemRoot\System32\LogFiles\Firewall\pfirewall.log" -Tail 300 | Select-String ' 3010 '
```

A `DROP` line naming the tester's address = Windows Firewall (fix the rule's
profile or remote scope with `-Action CreateScopedRule`). **No line at all**
while the temporary any-remote rule is active and the tester still fails =
the packet never reached Windows: network segmentation, Wi-Fi isolation, or
**SentinelOne Firewall Control**. Stop there; do not touch SentinelOne. Give
IT: host address, tester address, TCP 3010 inbound, and that a Windows
any-remote rule with logging showed nothing.

Do not modify a higher layer while a lower one is failing.

### The failure that actually happened (2026-09-08): a program Block rule

No other computer could connect, from any subnet, while every host-side
check passed. The cause was four inbound **Block** rules for
`C:\Program Files\nodejs\node.exe` (TCP and UDP, Domain and Public
profiles), named *"Node.js JavaScript Runtime"* and prefixed `TCP Query
User{…}` / `UDP Query User{…}`.

Windows writes exactly that rule when the *Windows Security Alert* for a
newly listening program is cancelled, dismissed, times out, or is shown to
an account that cannot approve it. On this workstation the owner's account
is **not a local administrator**, so every new listener - VS Code, Acrobat,
Phone Link, and Node - has been recorded as a Block. The firewall event log
shows the same service SID creating them, several per day.

Two consequences that are easy to get wrong:

- **A Block beats every Allow.** Adding an Allow rule for port 3010 - scoped
  or any-remote - changes nothing while the program Block exists. The
  temporary any-remote diagnostic rule would have produced a false "network
  problem" verdict.
- **Port-only inspection misses it.** The rule names the program, not a
  port. `diagnose-lan-access.ps1` and `firewall-lan-diagnostic.ps1
  -Action Inspect` now read the rule registry directly (no elevation needed)
  and match rules against the executable that owns the port as well.

**The fix** (one elevated action, administrator credentials):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/firewall-lan-diagnostic.ps1 -Action Fix
```

It records the Block rules to a state file, removes them, and creates one
narrow Allow: inbound TCP 3010, **Domain profile only**, remote scope
`LocalSubnet` - Windows' own keyword for this machine's directly connected
subnets, kept current when the lease or the adapter changes, and never the
internet. `-TesterIp <address>` narrows it to one workstation.
`-Action UndoFix` restores the removed rules exactly.

## 8. What to give IT when the host cannot be changed locally

Firewall changes need a local administrator, and if remote TCP still fails
after `-Action Fix` with a diagnostic session showing no packet reached
Windows, the remaining suspects are SentinelOne Firewall Control and network
segmentation - both IT's. Send this, filled in from the `pnpm dev` banner
and the tester's report:

| Item | Value |
| --- | --- |
| Purpose | Bert's Auto Parts HR Exit (Offboarding) Platform - internal UAT hosted on an HR workstation |
| Destination | this workstation's current LAN address (from the `pnpm dev` banner, e.g. `10.88.122.134`) and hostname |
| Port / protocol | **TCP 3010**, inbound |
| Source scope | the tester workstations' addresses, or the corporate Wi-Fi/wired subnets the testers sit on - internal LAN only, Domain profile |
| Process | `C:\Program Files\nodejs\node.exe` (the Next.js development server) |
| Duration | temporary - for the UAT window; remove afterwards |
| Not requested | no internet exposure, no port-forwarding, no change to PostgreSQL (loopback-only), no change to authentication |
| Evidence | `scripts/diagnose-lan-access.ps1` output; the tester's `ExitPlatformLAN-*.txt`; if run, the diagnostic-session file from `%LOCALAPPDATA%\ExitPlatform` |
| Asks | (1) an administrator to run `firewall-lan-diagnostic.ps1 -Action Fix`, or apply the equivalent rule; (2) if TCP still fails: confirm whether SentinelOne Firewall Control or a VLAN/AP policy blocks workstation-to-workstation TCP 3010 between the source and destination above |
