# TimeClock Pro — Progress Log
_Last updated: 2026-02-28_

## Repository
- GitHub: https://github.com/ilanwor/timeclock
- Local: `/Users/ilan/timeclock`
- Branch: `main` (up to date with origin)

## Dev Server
```bash
export PATH="/usr/local/lib/nodejs/node-v20.18.0-darwin-arm64/bin:$PATH"
npm run dev   # runs at http://localhost:5174
```

## Seed Accounts
| Name | Email | Password | PIN | Role |
|------|-------|----------|-----|------|
| Admin User | admin@timeclock.com | Admin1234! | 0000 | Super Admin |
| Maria Garcia | manager@timeclock.com | Manager1234! | 1111 | Manager |
| John Smith | employee@timeclock.com | Employee1234! | 2222 | Employee |

> PIN pad requires pressing ✓ after entering digits (no auto-submit)

## Reset DB (if needed)
Paste in browser console:
```js
indexedDB.deleteDatabase('TimeclockDB').onsuccess = () => location.reload()
```

---

## Git History (newest first)
1. `53c5d12` — Logout on Back to Kiosk/Sign Out; fix login redirect blank page
2. `2d94b80` — Block ending break before minimum break duration (30 min)
3. `0a7a7cb` — Fix TransactionInactiveError during database seed
4. `6b885f5` — Fix 8 bugs found in comprehensive code review
5. `8f52d68` — Fix first-load race condition: render after seed completes
6. `cba8823` — Add project README
7. `2a75852` — Initial commit — TimeClock Pro PWA

---

## Completed Features
- [x] Kiosk home — employee tiles, PIN pad, clock in/out/break flow
- [x] ClockFlow wizard — multi-step modal (blocks, warnings, notifications, break ack)
- [x] Priority-based rules engine (global → store → role → user)
- [x] Break compliance engine (reminder, penalty, min break duration)
- [x] Minimum break duration — End Break button disabled until 30 min elapsed
- [x] Auto sign-out for abandoned shifts
- [x] Admin panel with sidebar layout
- [x] Admin Inbox — alert notifications for managers
- [x] Admin Users — CRUD, PIN/password management
- [x] Admin Roles — permission management
- [x] Admin Stores — store management
- [x] Admin Notifications — structured notification templates
- [x] Admin Reports — timesheet, overtime summary, break compliance; CSV/PDF export
- [x] Admin Settings — all rules configurable; per-store kiosk colors
- [x] Alert router — routes events to manager inbox (Phase 2: email/SMS stubs)
- [x] PWA manifest — installable, offline-capable via Workbox service worker
- [x] Audit log — immutable record of all state changes

## Bug Fixes Applied
1. PIN "not recognised" typo → "not recognized"
2. `actions.js` clockOut/endBreak — null guards before accessing entry/break fields
3. PIN min length inconsistency — changed from 7 to 4 digits everywhere
4. AdminSettings saveAll — skip store-scoped groups when storeId=0 (global view)
5. evaluator.js — removed unused `endBreak` import
6. AuthContext — clear corrupted sessionStorage on JSON.parse failure
7. AdminReports — load `break_required_after` from settings instead of hardcoding 6h
8. ProtectedRoute — redirect to `/` instead of `/dashboard` to avoid redirect loop
9. Seed — bcrypt.hash() moved outside Dexie transaction (TransactionInactiveError fix)
10. Login — replaced imperative navigate()-during-render with declarative `<Navigate>`
11. AdminLayout — Back to Kiosk and Sign Out both now call logout() before navigating

## Tech Stack
- Vite 6 + React 19
- Dexie.js v3 (IndexedDB) — DB schema at v3
- bcryptjs (SALT_ROUNDS=8)
- date-fns, recharts
- Tailwind CSS
- vite-plugin-pwa + Workbox

## DB Schema (Dexie v3)
Tables: `stores`, `roles`, `users`, `time_entries`, `breaks`,
        `notification_responses`, `alerts`, `settings`, `audit_log`, `notifications`

## Key Settings (configurable in Admin → Settings)
- `unpaid_break_minutes` — minimum break duration (default 30 min)
- `break_required_after` — shift length requiring a break (default 6 hrs)
- `break_reminder_after_minutes` — reminder threshold (default 300 min)
- `break_penalty_enabled` / `break_penalty_minutes` — missed break penalty
- `rule_auto_signout_hours` — auto sign-out threshold (default 14 hrs)
- `overtime_threshold` — weekly OT threshold (default 40 hrs)
- `pin_length` — minimum PIN length (default 4 digits)

## Current Status
App is working and being tested by user. No known outstanding bugs.
User is continuing to test all functions.
