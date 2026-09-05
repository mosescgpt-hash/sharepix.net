# Verifying Moments after the deploy

Nothing in this feature has ever written to a real DynamoDB table. Synth, build
and 618 unit tests all pass, but that proves the shapes are right, not that the
plumbing works. This is the walkthrough that proves it.

Do it on a **test event you don't mind messing up**, not a customer's.

---

## 1. Host: create a moment

`/my-events` → open an event → **Manage event** → scroll to **Moments**.

1. Add one called `Ceremony`, description `Before the meal`.
2. Add a second called `Reception`.

**Expected:** both appear, in the order added.

**If it fails with "That event could not be found"** on an event you own, the
ownership check is misreading the caller. The owner field Amplify writes is
`<sub>::<username>` and `saveMoment` compares only the part before `::`. Check
the Lambda log for `save-moment`.

**If it fails with a table or permission error**, the backend deployed but the
new table did not attach — check `MOMENT_TABLE_NAME` is set on the
`save-moment` and `list-moments` functions in the Lambda console.

## 2. Host: the QR code

Click **QR code** on `Ceremony`.

**Expected:** a QR code, the moment name, and a URL ending
`/event/<id>/upload?moment=<uuid>`.

Scan it with a phone. It should open the upload page with **Ceremony** already
selected in the "Which part of the day?" picker.

## 3. Guest: upload into a moment

On the phone, still on the scanned link, add a photo.

**Expected:** it uploads exactly as before. The picker is a convenience — the
upload path itself is unchanged.

Then go to `/event/<id>/upload` **without** the query string and add another
photo, leaving the picker on "Not sure / just add them".

## 4. The payoff: the grouped gallery

Open `/event/<id>`.

**Expected:** two headings — `Ceremony` with the first photo under it,
`Reception` empty (kept deliberately, so the gallery agrees with the cards on
the tables), and `Everything else` with the unfiled photo.

## 5. The failure case that matters most

This is the one worth actually doing, because it is what happens in a real
venue when a host reprints cards.

1. Note the `Ceremony` moment's URL.
2. Delete `Ceremony` from the host dashboard. Confirm the warning.
3. Open the old URL on the phone and upload a photo.

**Expected:** the photo uploads normally and lands under **Everything else**.
The stale `?moment=` is silently ignored.

**A failed upload here is a bug, not a safety feature.** Refusing a guest's
photo at a party over a filing label is the wrong trade — if you see an error,
say so and it gets fixed before this goes near a customer.

Also confirm: the photo that was under `Ceremony` is **still in the gallery**,
now under `Everything else`. Deleting a moment must never delete photos.

## 6. Confirm nothing regressed

Open an event with **no** moments at all.

**Expected:** the upload page shows no picker, and the gallery is one grid with
no headings — byte-for-byte the behaviour before this shipped. This is the
common case and the one most users will ever see.

---

## The security property, if you want to check it

A host cannot write a moment into an event they do not own. `saveMoment` reads
the event and compares its stored owner to the caller before anything else, and
a rename additionally proves the moment already belongs to that event. The
`Moment` model itself grants no `create` and no `update`, so there is no second
path in.

You can sanity-check this from two accounts: sign in as host B, and try calling
`saveMoment` with host A's event id. It should answer "That event could not be
found" — the same message it gives for an event id that does not exist, so the
endpoint cannot be used to discover which events are real.

## Known limits, not bugs

- **Moments do not reorder from the UI yet.** They sort by the order they were
  created. Renaming keeps a moment's place.
- **Both list paths scan and filter** rather than using the secondary index,
  matching `listEventPhotos` and `eventGuestBook`. Fine at this scale; it is
  the same debt tracked in `docs/redesign-audit.md`.
- **Cap is 24 moments per event**, which is an abuse bound and a usability one.
