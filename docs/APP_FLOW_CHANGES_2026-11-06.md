# App flow changes - rollout notes

## Behavior

All application dialogs and activity feedback use AppDialog/AppPopup, including chat deletion,
undo and failure actions. Saved drafts/sold listings remain faded and unavailable. Public feeds,
nearby results and maps periodically revalidate; see the [cache audit](CACHE_AUDIT_2026-11-06.md).

A top-right button or Back minimizes an ongoing call. A floating bar restores or ends it.
Android uses a microphone foreground service for connected calls. iOS uses CallKit for system
call controls and its supported devices' call indicator. Incoming calls while the iOS process
is terminated still depend on the existing notification delivery; PushKit was not introduced.

New messages use authenticated TLS/WSS and server-side AES-256-GCM storage encryption, with
per-message random IVs and message/sender/recipient binding. Attachment storage remains private
and encrypted. PIN, backup, peer-key and security-code flows are removed, including their API
routes. Per the requested policy, older message and backup rows remain stored; older ciphertext
is withheld from API responses and appears unavailable. No database migration or deletion is needed.

## Deployment order

1. Create a distinct stable CHAT_MESSAGE_SECRET (32+ characters) in each environment's Chat
   service secret manager. A local development value has been generated in the ignored .env.
   Keep each cloud key outside the database and back it up separately. Never replace it without
   rewrapping the stored data. The key is not included in the app.
2. Deploy the backend changes, then distribute the app. Old-format sends are rejected by the
   new server; release the app update together with this server change.
3. Verify two-account send/reply/edit/delete, saved-card availability, nearby withdrawal and a
   real call while switching apps in staging. Do the iOS build and device checks on a Mac/iPhone.

The subsequent [environment consistency rollout](ENVIRONMENT_CONSISTENCY_2026-11-06.md)
deployed these changes to both Railway environments, configured separate managed chat keys,
and built verified staging/production release APKs. Use those named release APKs.

## Validation

Flutter analysis and all 1,060 Flutter tests pass. Android staging debug APK builds.
Chat: 147 tests; Property: 311 tests; Gateway: 86 tests pass. Six Meilisearch integration tests
remain skipped without their external test service. The managed QA fixture self-check and
modified parity-case syntax checks pass.
The subsequent rollout also passed all 73 staging flow tests and live service checks in
both environments. The iOS implementation cannot be built or hardware-tested in this Windows workspace.
