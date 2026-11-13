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
