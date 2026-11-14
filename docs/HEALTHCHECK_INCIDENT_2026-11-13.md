# Production startup / healthcheck incident — 2026-11-13

## Initial verified read-only observations (before repair)

Railway project `6c31c542-9708-4453-854b-3bc730744229`, environment
`f3ab82d3-a543-4852-8df6-681c8e73678c`:

- Latest Authentication, Users, property, Chat, payment and Notification deployments report
  `FAILED`, `stopped:true`; Gateway, Redis and rabbitmq report `SUCCESS`, `stopped:false`.
  This is latest-deployment state, not proof about every previous deployment or request.
- Runtime logs of **all six failed deployment IDs** show the same constructor error:
  `RABBITMQ_URL must be a valid amqp or amqps URL; production requires per-service credentials and managed topology`.
  Users logged this at `2026-11-13T08:16:12Z`; the other services logged it between
  `08:16:29Z` and `08:17:48Z`. Healthchecks subsequently time out because startup exits.
- Redacted variable checks on Users and Authentication show an AMQP URL is present and
  `RABBITMQ_MANAGED_TOPOLOGY=true`, but the username is not service-scoped. No secret values
  were printed. Do not describe this as a confirmed malformed AMQP URL.
- Broker has no advertised public management/TCP endpoint. Railway SSH returns
  `No registered SSH keys found`. No key was registered and no production variables,
  users, permissions, topology or deployments were changed in this investigation.

This explains a backend dependency outage consistent with the reported dashboard failures.
No authenticated dashboard request or on-device reproduction was performed.

## Required recovery

1. Establish operator access to the running broker (Railway SSH key or an existing private
   management connection). Keep its existing volume, queues and messages intact.
2. Use `scripts/security/provision-rabbitmq.cjs --apply` with six distinct generated passwords
   to provision source topology and restricted `tilomnov_authentication`, `tilomnov_user`,
   `tilomnov_property`, `tilomnov_chat`, `tilomnov_payment`, `tilomnov_notification` accounts.
   The default command prints a plan only. Do not relabel a shared/admin account URL as a
   scoped account without actually creating that user and its permissions.
3. Deliver each service's own AMQP URL through its Infisical folder, retaining
   `RABBITMQ_MANAGED_TOPOLOGY=true`. Verify sync does not restore the old shared URL.
4. Redeploy and verify all six healthchecks, sign-in/admin overview and actual message flow.
   Additional startup prerequisites may surface after this first crash is repaired.
5. Only then retry dashboard credential rotation. Local changes now reconcile a drifted
   Infisical baseline to verified live credentials before normal preflight and bootstrap.
   Failed deployments still block rotation with an explicit healthcheck/startup error.

Do not increase the healthcheck timeout or disable broker isolation to hide this startup error.

## Live repair performed after operator requested CLI recovery

- Registered a temporary dedicated Railway SSH key and opened loopback-only SSH tunnels;
  no public broker endpoint was created. Preserved the existing volume, queues and messages.
- Saved encrypted, Windows-user-bound backups of the original Infisical/Railway variables,
  broker definitions and newly generated distinct service passwords outside the repository.
- Applied the existing operator provisioner: six source exchanges, topology and six scoped
  application accounts. Confirmed all six logins and own-source publish permissions with
  unroutable probes (no queue delivery); Users was denied reading Authentication's queue
  and publishing as Authentication.
- Updated all six Infisical folders with their own AMQP URLs and managed topology flag.
  Verified all six service-folder syncs deliver the exact values to Railway.
- All nine latest Railway deployments subsequently reported `SUCCESS`, `stopped:false`.
  The seven HTTP services returned 200 to the Users health checker.
- Executed the deployed dashboard overview's read-only aggregation from Users: user/report,
  property and payment sections all returned successfully. Rotation history returned `ok`
  with all seven records present. This does not replace an authenticated on-device UI test.
- Found the independent rotation-preflight cause: all six live service folders agreed on
  the internal secret, but the root canonical value was different. Reconciled the root to
  the verified live baseline, preserving live service credentials. All six then passed
  the real Railway deployment-snapshot preflight.

Workflow publication, a controlled real rotation and temporary-access cleanup are recorded
in the follow-up outcome below; do not infer those from the observations above alone.

## Verified follow-up outcome

- PR [48](https://github.com/GenieMapKH/GenieBackend/pull/48) was merged normally into
  `main` as `b288faffaf0f3a028b81bab0a076bd8b26dac425`. The pull-request CI run
  [43440484312](https://github.com/GenieMapKH/GenieBackend/actions/runs/43440484312)
  succeeded, including all workspace tests, broker/security integration and seven Docker
  image builds. The separate branch-push staging job failed before deployment because
  `RAILWAY_STAGING_TOKEN` is absent; no staging credentials were fabricated or broadened.
- The real notification-only rotation
  [43396171399](https://github.com/GenieMapKH/GenieBackend/actions/runs/43396171399)
  succeeded: `notification: now on notification_service_2`, followed by a verified Railway
  handover. All six standby database logins were independently checked; unused-login
  connection counts were zero. Other database/shared credentials were not force-rotated.
- The published `main` workflow also completed a fresh, non-mutating dry run successfully:
  [43442367160](https://github.com/GenieMapKH/GenieBackend/actions/runs/43442367160).
  A dry run does not prove handover; the real rotation and final preflight above are separate.
- Secret sync initially rebuilt older successful application revisions. HTTP health alone
  missed their incompatible legacy shared-exchange messaging code. Redeployed the intended
  security-fixed revision explicitly, then completed the merged-main automatic rollout.
  Final latest-deployment state for all nine Railway services is `SUCCESS`, `stopped:false`.
- The real Chat conversation failure was PostgreSQL `42501`: the shared chat/call
  `DISPLAY_FIELDS` helper selected recovery email and phone, which its restricted role
  correctly cannot read. Removed those private selections and fallbacks; did not widen grants.
  Reproduced the denied old query, proved the corrected query works, and proved password-hash
  access remains denied. The deployed conversation list and two histories load successfully.
  The operator then confirmed in the app: **Chat loads and sends successfully**.
- Latest deployed Users reports the merged-main commit. Its real dashboard aggregation,
  all seven HTTP health probes and rotation history succeed. Final snapshot preflight passes
  for all six services with root/shared baseline equality. Broker accounts remain scoped,
  required consumers run, and final main/retry/dead queue message counts were all zero.
  Users and Payment are producers and correctly have no consumer.
- Local focused validation also passed: 156 chat tests, 17 broker integration scenarios,
  12 security integration scenarios and 44 script tests. The H02 integration test now executes
  the actual Prisma display projection under `SET LOCAL ROLE chat_service`; mandatory
  publishing tests now use a real source exchange rather than the retired shared exchange.
- Reviewed the latest deployment logs of Authentication, Users, property, Chat, payment,
  Notification, Gateway, rabbitmq and Redis. Historical failed-revision errors remain in
  retained broker logs; the non-blocking Sentry stream/transaction-hook startup warning
  remains. Log history was not erased to make it appear clean.

Cleanup: the temporary Railway SSH key was revoked and the account key list verified empty;
the exact recovery-tunnel process was stopped; loopback ports 5673/15673 have no listener;
the four temporary SSH key/public-key/config/known-host files were removed. The two local
messaging fixture containers were restored to their original stopped state and their
existing volumes retained. The guarded security test database was removed by its runner.

Encrypted, Windows-user-bound rollback backups and redacted operational evidence remain in
`C:\Users\SengPooPoo\.codex\operations\tilomnov-recovery-20261113` outside Git. No user messages,
financial rows or broker queues were bulk-deleted. No production grants were weakened.

Remaining limits: no real bank settlement/refund, call audio, or deliberate external email/push
delivery test was performed. Successful healthchecks and chat confirmation are not proof of
every product flow or immunity to future provider outages.
