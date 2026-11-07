# Cache audit - 6 November 2026

The initial read-only checks covered Railway Staging and production. Full sanitized evidence is in
[CACHE_AUDIT_2026-11-06.json](CACHE_AUDIT_2026-11-06.json).

- Every configured Redis client (Authentication, Users, Property, Chat, Notification and Gateway)
  matches its own environment's Redis URL. The environments have distinct Redis credentials.
  Payment does not use Redis and needs no Redis URL.
- No inspected service configures a read replica, so replica lag does not explain these symptoms.
- Both gateways answered health and public nearby listings with HTTP 200. Unauthenticated
  chat history returned 401. Those responses had no Cache-Control or Age header.
- Samples of up to 200 recent log lines per Property, Chat, Gateway and Redis showed no Redis
  unavailable events or cache errors. Production Gateway includes 35 historical upstream
  connection refusals, last at 17:39 Phnom Penh time; these are not Redis/cache failures.
- Redis exposes no configured public endpoint, so direct PING, eviction counters and TTLs
  could not be inspected from this machine. Configuration agreement is not a Redis health test.

## Source fixes

The app retained nearby results indefinitely and allowed feed data to remain for five minutes.
It now quietly rechecks loaded listings every 30 seconds while foregrounded, on resume, and
when the feed returns after becoming stale. Public lists remove withdrawn listings; saved cards
keep a limited summary, fade and show Unavailable. Opening and map actions are disabled for
unavailable cards, while unsaving remains available. Draft details, contacts and locations are
withheld. Deleted listings and deactivated owners remain excluded.

The existing server invalidation covers listing lifecycle changes. Public detail entries now
carry versions too, preventing an older request from repopulating the current cache after
withdrawal. Public list/detail TTLs remain 30/60 seconds. API gateway responses gain no-store;
chat and authentication responses bypass the app's general API memory cache.

Offline copies can show the last known state until connectivity returns.

## Subsequent rollout verification

The [environment consistency rollout](ENVIRONMENT_CONSISTENCY_2026-11-06.md) deployed the
fixes to both environments. Staging passed all 73 flow tests, including a buyer's warmed
nearby query after the seller unpublishes, and saved Draft/Sold cards. Live authenticated
reads in both environments now assert `Cache-Control: no-store`; logout invalidates the
session and each environment rejects the other's token. No Redis cache flush was needed.
The reproduced intermittent 500s were database session exhaustion, corrected by limiting
the combined six-service connection budget to 12 against the pooler's 15-session limit.
