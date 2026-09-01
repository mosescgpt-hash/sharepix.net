# Who can write an event

Events are the only object in SharePix that *is* money. The plan, the photo and
video limits, the purchased credits, both lifecycle dates and the `paid` flag
all decide what someone gets for what they paid. This note records how those
fields are written and why the obvious approach wasn't safe.

## What used to be true

Events were created by a direct client-side model write. The browser sent:

| Field | Set by |
| --- | --- |
| `tier` | the client |
| `photoLimit`, `videoLimit` | the client |
| `accessExpiresAt`, `uploadWindowEndsAt` | the client |
| `eventCode` | the client (`Math.random`) |
| `paid` | the client — **defaulting to `true`** |

The create-event page sent `paid: false` on the checkout path and `paid: true`
on the comped and corporate paths, so the product behaved correctly. But nothing
*enforced* that. A signed-in host who sent the `createEvent` model mutation
themselves — one `fetch`, no special tooling — could mint an unlimited, active,
never-expiring Premium event without going near Stripe. The UI was the only
thing standing in the way.

The owner rule also granted `update` on the whole row, so even a correctly
created pending event could be activated a second later with
`Event.update({ id, paid: true })`. Fixing creation alone would have moved the
hole rather than closed it.

## What is true now

The `Event` model grants:

| Who | Operations |
| --- | --- |
| Owner (the host) | `get`, `list`, `delete` |
| Signed-in users, guests | `get` |
| `ADMINS` | everything |

No `create` and no `update` for hosts. Events come from two functions:

- **`createEvent`** (`amplify/functions/create-event/`) — the request carries a
  name, a date, a place, a plan and optionally a discount code. Everything else
  is derived: limits and dates from the plan table, the event code from the
  CSPRNG, the owner from the caller's token, and `paid` from the activation
  rule. The rules are pure functions in `newEvent.ts`, tested directly.
- **`updateEventSettings`** (`amplify/functions/update-event/`) — writes only
  the fields on its allow-list: `name`, `date`, `location`, `moderationMode`,
  `alertEmail`, `videoUploadsEnabled`, `guestDownloadsBlocked`, `uploadsClosed`.
  A test asserts that nothing priced, counted or dated has crept into that list.

Admins keep full model access. They can already comp any event, so restricting
them buys nothing, and the global-admin dashboard writes `extraPhotoCredits` and
`uploadWindowEndsAt` directly.

## How an event becomes active

There are exactly two ways to open an active event without paying, and both are
checked against a table the request can't influence:

1. **A live Corporate subscription** — read from the caller's own
   `CorporateSubscription` row (`active`, `trialing` or `past_due`).
2. **A discount code that covers the whole price** — read from the
   `DiscountCode` table, checked for active/unexpired/uses-remaining/scope, and
   then priced. A remainder Stripe is too small to charge (under 50c) counts as
   comped, because the alternative is a checkout that fails at the card step.

Anything else is created with `paid: false`. `createEventPhoto` refuses uploads
to an event with `paid: false`, so a pending event is inert until the Stripe
webhook flips it.

A **partial** code is not spent at creation. It rides along to Stripe as a
coupon and the webhook counts the redemption once payment completes, so a host
who abandons checkout hasn't consumed a use.

A **comping** code is spent in the same request that creates the event, with a
conditional update that re-checks every condition — active, unexpired, uses
remaining — so a code that ran out between the read and the write loses there.

## Why `redeemDiscountCode` is gone

It was a mutation any signed-in caller could run against any code they could
name, which incremented `usedCount` and returned a confirmation. It burned an
admin's limited-use codes without buying anything. The create-event page also
called it as a *separate step before* creating the event, so an interrupted
signup spent a use for nothing. Redemption now happens inside `createEvent`.

`validateDiscountCode` stays — it only reads, and the page needs it for the
live price preview.

## What this does not cover

Field-level authorization was considered and not used. An Amplify field rule
governs reads as well as writes, and guests read most of these fields to open a
gallery; a rule that silently redacted `accessExpiresAt` would break every
gallery with no error to find. The function boundary fails loudly instead.
