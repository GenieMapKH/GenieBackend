# Tilomnov end-to-end use-case test: production vs staging

Run 5 Nov 2026, 13:27 (Phnom Penh time). 71 use cases, each run on staging and production through the public gateway, as the app calls it. "Same" means the same outcome, the same status for every request and the same response fields and types; values (ids, dates, other people's listings) are not compared.

## Verdict

- **Production and staging behave the same: NO** (12 of 71 use cases differ)
- **Every use case passes: NO**

| | staging | production |
|---|---|---|
| Passed | 59 | 71 |
| Failed | 1 | 0 |
| Errors (crashed case) | 0 | 0 |
| Skipped (an earlier case failed) | 11 | 0 |
| Requests made | 306 | 344 |
| Median response | 128 ms | 108 ms |
| 95th percentile response | 538 ms | 598 ms |
| Run time | 90 s | 122 s |
| Network retries | 0 | 0 |
| Gateway | https://gateway-staging-c9ff.up.railway.app | https://tilomnovgateway.sparkbytekh.com |

## Where production and staging differ

### CHT-01 Every account publishes its chat key; others can fetch it
- outcome: fail vs pass
- requests made: 1 vs 5

### CHT-02 Chat PIN backup: describe, unlock with the right PIN, refuse a wrong one, replace only with proof
- outcome: skip vs pass

### CHT-03 Chat socket: refuses no token, a forged token and an unknown API version; connects when signed in
- outcome: skip vs pass

### CHT-04 Seller sends a message; buyer gets it live; a resend with the same id is not duplicated
- outcome: skip vs pass

### CHT-05 Conversation list, history paging and marking as read
- outcome: skip vs pass

### CHT-06 Reply, edit (own message only) and delete for everyone, seen live by the other side
- outcome: skip vs pass

### CHT-07 Sending is refused: to yourself, malformed, unknown recipient, and to someone who blocked you
- outcome: skip vs pass

### CHT-08 Photo attachment: upload link, storage upload, download link for the two people only, removal
- outcome: skip vs pass

### CHT-09 Archive and unarchive a conversation
- outcome: skip vs pass

### CHT-10 Online status: buyer watches the seller and sees them online
- outcome: skip vs pass

### CAL-02 Voice call: invite, ring, accept, exchange signals, hang up, appears in call history
- outcome: skip vs pass

### CAL-03 Declined call ends for the caller; calling someone who blocked you is refused
- outcome: skip vs pass

## What failed on staging

- **CHT-01** Every account publishes its chat key; others can fetch it — **FAIL**
  - buyer: creating the chat PIN gave 403
- **CHT-02** Chat PIN backup: describe, unlock with the right PIN, refuse a wrong one, replace only with proof — skipped
  - Needs chatReady from an earlier case that failed
- **CHT-03** Chat socket: refuses no token, a forged token and an unknown API version; connects when signed in — skipped
  - Needs chatReady from an earlier case that failed
- **CHT-04** Seller sends a message; buyer gets it live; a resend with the same id is not duplicated — skipped
  - Needs sockets from an earlier case that failed
- **CHT-05** Conversation list, history paging and marking as read — skipped
  - Needs firstMessageId from an earlier case that failed
- **CHT-06** Reply, edit (own message only) and delete for everyone, seen live by the other side — skipped
  - Needs firstMessageId from an earlier case that failed
- **CHT-07** Sending is refused: to yourself, malformed, unknown recipient, and to someone who blocked you — skipped
  - Needs sockets from an earlier case that failed
- **CHT-08** Photo attachment: upload link, storage upload, download link for the two people only, removal — skipped
  - Needs sockets from an earlier case that failed
- **CHT-09** Archive and unarchive a conversation — skipped
  - Needs firstMessageId from an earlier case that failed
- **CHT-10** Online status: buyer watches the seller and sees them online — skipped
  - Needs sockets from an earlier case that failed
- **CAL-02** Voice call: invite, ring, accept, exchange signals, hang up, appears in call history — skipped
  - Needs sockets from an earlier case that failed
- **CAL-03** Declined call ends for the caller; calling someone who blocked you is refused — skipped
  - Needs sockets from an earlier case that failed

## Every use case

| ID | Area | Use case | staging | production | Same on both? |
|---|---|---|---|---|---|
| ENV-01 | Setup | Gateway answers its health check | pass | pass | same |
| ENV-02 | Setup | Unknown API version is refused, unversioned paths still served (old app builds) | pass | pass | same |
| AUTH-01 | Sign-in | The 3 QA accounts sign in by phone + password (registered on the first run) | pass | pass | same |
| SETUP-01 | Setup | Leftovers of earlier runs are removed (QA accounts only) | pass | pass | same |
| AUTH-02 | Sign-in | Registration refuses bad input and an existing phone | pass | pass | same |
| AUTH-03 | Sign-in | Login refuses a wrong password, an unknown phone and missing fields | pass | pass | same |
| AUTH-04 | Sign-in | Protected routes refuse no token, a forged token, and accept "bearer" in any case | pass | pass | same |
| AUTH-05 | Sign-in | Password reset: email OTP and SMS paths refuse bad codes without revealing accounts | pass | pass | same |
| AUTH-06 | Sign-in | Google (Firebase) sign-in refuses a forged token | pass | pass | same |
| AUTH-07 | Sign-in | Refresh and logout refuse forged refresh tokens | pass | pass | same |
| PRO-01 | Profile | Own profile is read back with the phone it was registered with | pass | pass | same |
| PRO-02 | Profile | Edit profile: name, first/last name, sex and username are saved | pass | pass | same |
| PRO-03 | Profile | Profile edits with bad values are refused | pass | pass | same |
| PRO-04 | Profile | Username availability check | pass | pass | same |
| PRO-05 | Profile | Another user's public profile shows no private fields; unknown ids are refused | pass | pass | same |
| PRO-06 | Profile | Profile picture: upload, use, fetch, remove | pass | pass | same |
| LST-01 | Listings | Seller saves a new listing as a draft, with house details | pass | pass | same |
| LST-02 | Listings | Listings with bad values are refused | pass | pass | same |
| LST-03 | Listings | Seller finds the draft in My Properties (all, and the Draft tab with counts) | pass | pass | same |
| LST-04 | Listings | A draft is private: others can't see, edit, publish or delete it | pass | pass | same |
| LST-05 | Listings | Seller edits price, description and keywords | pass | pass | same |
| LST-06 | Listings | Seller places the pin and draws the land boundary | pass | pass | same |
| LST-07 | Listings | Seller uploads a photo: upload link, storage upload, confirm, thumbnail | pass | pass | same |
| LST-08 | Listings | Seller publishes the draft (free publish); publishing twice is refused | pass | pass | same |
| LST-09 | Listings | Published listing is on the map, in "closest", and its detail page hides owner contact from guests | pass | pass | same |
| LST-10 | Listings | Unpublish takes it off the map; publishing again puts it back | pass | pass | same |
| LST-11 | Listings | Mark as sold, then relist | pass | pass | same |
| LST-12 | Listings | App flow: a listing created as Active goes on the map once its boundary is drawn | pass | pass | same |
| ENG-01 | Buyer actions | Buyer likes and unlikes a listing | pass | pass | same |
| ENG-02 | Buyer actions | Buyer saves a listing; it shows in Saved (ids, list, paged); unsaving removes it | pass | pass | same |
| ENG-03 | Buyer actions | Views are counted for buyers, not for the owner's own visits | pass | pass | same |
| ENG-04 | Buyer actions | Call / Chat taps are recorded as leads for the owner | pass | pass | same |
| ENG-05 | Buyer actions | Contact form to the owner (and its validation) | pass | pass | same |
| ENG-06 | Buyer actions | Insights are for the owner only | pass | pass | same |
| DSC-01 | Search & discovery | Guest browses the Phnom Penh map, with type/price filters; bad areas are refused | pass | pass | same |
| DSC-02 | Search & discovery | Closest listings to a point (the map pull-up sheet) | pass | pass | same |
| DSC-03 | Search & discovery | Guest session is registered for a device id | pass | pass | same |
| DSC-04 | Search & discovery | Home search finds places (Google), listings and people; empty query refused | pass | pass | same |
| DSC-05 | Search & discovery | Publisher page: a person's public profile with their live listings | pass | pass | same |
| DSC-06 | Search & discovery | Recent searches: record, list, delete | pass | pass | same |
| DSC-07 | Search & discovery | Saved searches: save the map area, rename, turn alerts off, delete; others can't touch it | pass | pass | same |
| SOC-01 | Follow, block, report | Buyer follows the seller; the seller's listing appears in the Feed; unfollow | pass | pass | same |
| SOC-02 | Follow, block, report | Block: listed under Blocked accounts, stops following and messaging; unblock | pass | pass | same |
| SOC-03 | Follow, block, report | Reports: bad and impossible reports are refused, the queue is admin-only | pass | pass | same |
| CHT-01 | Chat | Every account publishes its chat key; others can fetch it | **FAIL** | pass | **different** |
| CHT-02 | Chat | Chat PIN backup: describe, unlock with the right PIN, refuse a wrong one, replace only with proof | skipped | pass | **different** |
| CHT-03 | Chat | Chat socket: refuses no token, a forged token and an unknown API version; connects when signed in | skipped | pass | **different** |
| CHT-04 | Chat | Seller sends a message; buyer gets it live; a resend with the same id is not duplicated | skipped | pass | **different** |
| CHT-05 | Chat | Conversation list, history paging and marking as read | skipped | pass | **different** |
| CHT-06 | Chat | Reply, edit (own message only) and delete for everyone, seen live by the other side | skipped | pass | **different** |
| CHT-07 | Chat | Sending is refused: to yourself, malformed, unknown recipient, and to someone who blocked you | skipped | pass | **different** |
| CHT-08 | Chat | Photo attachment: upload link, storage upload, download link for the two people only, removal | skipped | pass | **different** |
| CHT-09 | Chat | Archive and unarchive a conversation | skipped | pass | **different** |
| CHT-10 | Chat | Online status: buyer watches the seller and sees them online | skipped | pass | **different** |
| CAL-01 | Calls | Call relay (TURN) servers are handed out | pass | pass | same |
| CAL-02 | Calls | Voice call: invite, ring, accept, exchange signals, hang up, appears in call history | skipped | pass | **different** |
| CAL-03 | Calls | Declined call ends for the caller; calling someone who blocked you is refused | skipped | pass | **different** |
| NTF-01 | Notifications | Push device is registered and removed (as on sign-in / sign-out) | pass | pass | same |
| NTF-02 | Notifications | Notification settings: read, switch one off, switch it back | pass | pass | same |
| NTF-03 | Notifications | Sending a promotion is admin-only | pass | pass | same |
| PAY-01 | Payments | Checkout refuses guests, bad input and someone else's listing (no payment is started) | pass | pass | same |
| PAY-02 | Payments | Payment webhook refuses unsigned callbacks | pass | pass | same |
| PAY-03 | Payments | Routes the app already calls but the backend does not have yet _(known gap: subscription checkout and transaction status are app-only so far)_ | pass | pass | same |
| ACC-01 | Account & sessions | Signed-in devices list marks this device, and a day-old device rule applies | pass | pass | same |
| ACC-02 | Account & sessions | Sensitive changes are refused on a device signed in less than a day ago (DEVICE_TOO_NEW) | pass | pass | same |
| ACC-03 | Account & sessions | Password proof (for chat PIN recovery): wrong password refused, right one gives a token | pass | pass | same |
| ACC-04 | Account & sessions | A new device cannot sign out another one; a device that signs itself out stops working at once | pass | pass | same |
| END-01 | Listings | Seller removes the photo, then deletes the listing; it is gone everywhere | pass | pass | same |
| END-02 | Clean-up & sign-out | All QA test data is removed (conversations, follows, favourites, saved searches...) | pass | pass | same |
| END-03 | Sign-in | Refresh rotates tokens; reusing an old refresh token signs every device out (theft protection) | pass | pass | same |
| END-99 | Clean-up & sign-out | Seller and buyer sign out; their tokens stop working | pass | pass | same |

## Notes from production

- AUTH-01: seller: registered +12025550171 (first run on this environment)
- AUTH-01: buyer: registered +12025550172 (first run on this environment)
- AUTH-01: outsider: registered +12025550173 (first run on this environment)
- CHT-01: seller: chat PIN created (first run on this environment)
- CHT-01: buyer: chat PIN created (first run on this environment)
- CHT-01: outsider: chat PIN created (first run on this environment)
