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

## 5. Verification from a second workstation

Do these from the tester's machine, not from the host - localhost working
on the host proves nothing about LAN access.

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
