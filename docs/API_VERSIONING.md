# API versioning

The app's API is versioned in the path: `/v1/properties`, `/v1/chat/conversations`. The chat
WebSocket carries the version in its handshake. Installed app builds keep working while the
backend changes, and builds that are too old are told to update instead of failing at random.

## What is versioned

| Surface | How the version is sent | Without a version |
|---|---|---|
| HTTP API (everything the gateway routes) | First path segment: `/v1/...` | Answered as v1 (app builds from before versioning) |
| Chat WebSocket (`/chat` namespace) | `auth: { token, apiVersion: '1' }` | Treated as v1 |
| `/internal/...` (service to service) | Never versioned | – |
| `/health` | Never versioned | – |

`/internal` and `/health` are not part of the app's contract: only our own services and the
hosting platform call them, from the same commit.

## Where the versions live

One list, [`shared/src/api-versioning/api-versions.ts`](../shared/src/api-versioning/api-versions.ts),
read by the gateway (routing), every service (`enableApiVersioning` in each `main.ts`) and the
chat socket handshake:

```ts
export const API_VERSIONS: ApiVersions = {
  served: ['1'],   // answered, oldest first; the last one is current
  retired: [],     // answered 410 api_version_retired
  unversioned: '1', // what a path without /vN means
};
```

What a client gets:

| Request | Answer |
|---|---|
| Served version | Normal answer, with header `API-Version: <n>` |
| Retired version | `410` `{ statusCode: 410, error: 'Gone', code: 'api_version_retired', message }`, before any token check. The socket is refused with the error `api_version_retired` |
| Version nobody serves (`/v9`) | `404`. The socket is refused with `api_version_unknown` |

The app shows a full-screen "Update required" page for `api_version_retired`
(`lib/core/network/api_version_interceptor.dart`, `lib/app/update/`). Every build since
versioning has this, so retiring a version later is safe for them.

## Does a change need a new version?

No new version, the same handler changes:

- a new endpoint;
- a new optional request field or query parameter;
- a new field in a response;
- a looser validation rule.

A new version, because an installed app would break:

- removing or renaming a field, path or query parameter;
- changing a field's type or meaning (a price in cents instead of dollars);
- a new required request field, or a stricter validation rule;
- a different status code for the same outcome;
- a WebSocket event that is renamed, removed or changes its payload.

## Making a breaking change (v1 → v2)

1. Add `'2'` to `served` (`['1', '2']`). Every handler without `@Version` now answers both
   `/v1` and `/v2`, so only the endpoints that change need new code.
2. In the controller that owns the endpoint, keep the old handler and mark it `@Version('1')`.
   Add the new one with `@Version('2')`. Share the service code. Only the request and
   response shapes should differ.

   ```ts
   @Version('1')
   @Get(':id')
   findOneV1(@Param('id') id: string) {
     return this.query.findOne(id).then(toListingV1);
   }

   @Version('2')
   @Get(':id')
   findOne(@Param('id') id: string) {
     return this.query.findOne(id);
   }
   ```

3. Socket events: branch on `socketApiVersion(client)` from `chat/src/chat/ws-api-version.ts`
   where the payload differs.
4. Deploy the backend first, then release the app with `AppConfig.apiVersion = '2'`.
5. Document the v2 shape in the README API overview.

## Retiring a version

When no supported app build uses v1 any more:

1. Move `'1'` from `served` to `retired` (`served: ['2'], retired: ['1']`). Unversioned
   paths retire with it, because `unversioned` is `'1'`.
2. Delete the `@Version('1')` handlers and v1 socket branches.
3. Deploy. Old builds now show "Update required".

## Rollout note

The services also answer paths without a version (`VERSION_NEUTRAL` in
`enableApiVersioning`). This means the gateway and the services can be deployed in any order:
a gateway from before versioning still forwards `/properties`. The new gateway always
forwards the versioned path. Once every service and the gateway run this code, the
`VERSION_NEUTRAL` entry can be removed.
