# VaultAccess

Functional local web prototype for the customer-facing VaultAccess usable-security project.

There is **no staff console in this package**. The staff module is intentionally excluded because it is being developed separately by another group member.

## What is functional

- Real dummy account login validation through a local Node.js backend
- 4 dummy customer accounts with different security scenarios
- Wrong-password attempt counting
- Temporary source blocking after repeated failed attempts
- New-device OTP verification
- High-risk Protected Mode
- Dynamically generated OTP codes
- Final identity challenge
- Alternate verification using a recovery code
- Source blocking instead of automatic full-account lockout
- Customer dashboard backed by server state
- Clickable security activity
- Mark activity as yours / report as unauthorized
- Active sessions and session revocation
- Security Checkup state
- Persistent JSON data while the server is running/restarted

## Demo accounts

All accounts use this password:

`Vault123!`

| Account | Purpose |
| --- | --- |
| `level1@dummy.demo` | Level 1 / recognized-device demo |
| `level2@dummy.demo` | Level 2 / new-device OTP demo |
| `level3@dummy.demo` | Level 3 / Protected Mode demo |
| `recovery@dummy.demo` | Alternate-recovery demo |

Recovery code:

`RECOVER-2026`

## How to run

### Windows
Double-click:

`start.bat`

or open Command Prompt in this folder and run:

`node server.js`

Then open:

`http://localhost:3000`

### macOS / Linux
Run:

`./start.sh`

or:

`node server.js`

Then open:

`http://localhost:3000`

## No npm install needed

The server uses only Node.js built-in modules. There are no third-party packages.

## Suggested defense demo

1. Level 1 account → successful standard login.
2. Level 2 account → correct password → OTP verification.
3. Level 3 account → Protected Mode → Final Identity Challenge.
4. Enter a wrong challenge OTP three times → current source is blocked, but the customer account is not globally locked.
5. Reset the demo.
6. Recovery account → Alternate Verification → enter `RECOVER-2026`.
7. Open dashboard → click Activity and Active Sessions to show that the site is stateful and interactive.

## Resetting

Open **View demo accounts** on the login page and click **Reset Demo Data**.

This clears activity, source blocks, current login sessions, and trusted-device demo state.
