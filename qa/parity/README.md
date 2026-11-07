# Production vs staging parity tests

End-to-end tests of every app use case, run through the public gateway the
way the Flutter app calls it (`/v1` paths, bearer tokens, the app's device
headers, the chat socket). The same 75 cases run on staging and on
production, and the report shows whether the two behave the same.

"The same" means, for every case: the same outcome, the same HTTP status (or
socket answer) for every request in the same order, and the same response
fields and types. Values (ids, dates, other people's listings) are not
compared: the two databases hold different data.

## Running

For routine live service checks, use `node check-live.js staging production`.
This signs an existing QA account in and out, checks authenticated reads, TURN,
cross-environment token isolation, retired chat routes and a refused checkout for
a nonexistent listing. It never registers accounts or writes listings, messages,
preferences or payment transactions. The sanitized report contains no tokens or user data.

```bash
cd qa/parity
npm install                       # once: socket.io-client only
cp .env.example .env              # once: then fill in the QA passwords
node run.js staging production    # both, plus the comparison (about 4 minutes)
node run.js staging               # one environment
node run.js staging --only=LST-01,LST-08   # a few cases (sign-in and clean-up always run)
```

Exit code 0 means every case passed on every environment and the
environments match. The report is written to `reports/<time>-<envs>.md`,
with a `.json` beside it holding every request's status and response shape.

## What it does to production

Agreed on 2026-11-05: the full suite runs on production, and it cleans up after itself.

- **Three fixed QA accounts per environment**, registered on the first run and
  reused on every run after it. Their numbers, `+1 202 555 0171/0172/0173`, are
  in a fictional range, so no real person can own them. They show up in people
  search as "Tilomnov QA Seller/Buyer/Outsider (automated test)". The accounts
  are never deleted: deleting an account needs a device that has been signed
  in for a day, and every run signs in fresh.
- **Test listings** are titled `[QA automated test]` and pinned in the empty
  South Pacific (near Point Nemo), so no real user's map, saved-search alert
  or "closest" list comes near them. Each is live for about a minute, then
  deleted. Deleting a listing is a soft delete, so a row with status
  `Deleted` stays in the database from each run.
- **No real reports and no payments.** A report would stay in the admins'
  queue, so only refused reports are sent. Checkout is checked only for
  refusals, all of which happen before a payment row is written.
- **Removed at the end of every run:** chats between the QA accounts (deleted
  for everyone), follows, blocks, favourites, saved searches, search history,
  the profile picture, the listing photo and the push device. Every session
  the run opened is signed out. The start of each run also removes anything
  an interrupted run left behind.
- Side effects that stay: Google Places is called about 4 times per run (search,
  one place lookup, a nearby search for the ocean listing). A guest-session row
  is written for the device id `qa-runner-<env>`.

## Limits

The suite paces itself under the gateway's 300 requests a minute. Some
per-account limits mean it should be run **at most 5 times in 15 minutes**
(chat backup lookups) and **10 times an hour** (reports) per environment.
Running it more often makes later runs fail with 429 errors, and those
failures are not real differences.

## Reading a failure

- `FAIL` gives the request, the expected status and the answer. `SKIP` means
  an earlier case it depends on failed. Fix that case first.
- "Where production and staging differ" lists, per case, the first status or
  field that is not the same.
- Run the suite again before acting on a single failure. A real difference
  shows up on every run; a network blip is listed under "Network retries".

## Adding a case

Cases live in `cases/NN-area.js`, in run order (see `cases/index.js`). A case is

```js
{ id: 'LST-14', area: 'Listings', title: 'What the user does', needs: ['listingId'], run: async (t) => {
    const res = await t.call('seller', 'PATCH', '/properties/:id', { params: { id: t.state.listingId }, body: {...}, expect: 200 });
    t.check(res.body.price === '1', 'why it failed');
} }
```

`t.call(role | null, method, path, { params, query, body, expect, label })`
makes and records one request: the role is `seller`, `buyer` or `outsider`, and
`null` means a guest. `needs` names `t.state` keys an earlier case must have set.
Use `parity: 'outcome'` for cases whose requests depend on leftover data.
Anything a case creates must be removed by the end of the run.
