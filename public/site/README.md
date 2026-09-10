# Drop photos in here

Two folders. Put image files in them, and they appear on the site.

    slots/     the homepage hero and the six occasion squares
    gallery/   the sample gallery at /demo/gallery

Then run:

    npm run images

That rewrites `lib/siteImages.generated.ts`, which is what the site actually
reads. Commit the photos and that file together and push; the deploy picks them
up. `npm run build` runs the same step, so a forgotten `npm run images` cannot
ship a half-updated site — but running it yourself is how you see the result
locally before pushing.

## slots/

The filename **is** the position on the page. Name a file after the slot it
fills, keeping the extension:

| File                        | Where it shows                  |
| --------------------------- | ------------------------------- |
| `home-hero.webp`            | The big arched image, homepage  |
| `occasion-wedding.webp`     | Weddings square                 |
| `occasion-birthday.webp`    | Birthdays square                |
| `occasion-graduation.webp`  | Graduations square              |
| `occasion-corporate.webp`   | Corporate square                |
| `occasion-holiday.webp`     | Holidays square                 |
| `occasion-reunion.webp`     | Reunions square                 |

A few more slot names exist for pages that have not been built yet — the full
list is `IMAGE_SLOTS` in `lib/imagery.ts`, and `npm run images` prints it if you
get a name wrong.

**A misspelled filename fails the build** rather than being ignored. That is on
purpose: a file quietly doing nothing, with the old placeholder still on the
page, is a much worse afternoon than an error message naming the problem.

To take a photo back off the site, delete the file and run `npm run images`.
The square returns to the gradient it had before — never a broken image.

## gallery/

Any filenames. They are shown in alphabetical order, so number them:

    01-the-aisle.webp
    02-family.webp
    03-the-long-table.webp

**The filename becomes the photo's description.** `05-first-dance.webp` becomes
"First dance" — the leading number is dropped and the hyphens become spaces.
That text is what a screen reader announces on the sample slideshow, and what is
printed on the placeholder tile when there is no photograph. It is not currently
shown as a visible caption under the tiles in the grid; the grid has never had
captions. Name the files properly anyway — it is the only description these
images have.

Empty the folder and the sample gallery falls back to the generated gradient
tiles it used before. Nothing breaks either way.

## What to put in

WebP or AVIF if you have them, JPEG or PNG otherwise. **Around 900×900 for the
squares and the gallery, and roughly 1200 wide for the hero, at 100–200 KB
each.** These load on every homepage visit, and a folder of 2 MB phone
photographs will be the slowest thing on the site.

Nothing here is resized or compressed for you. Export them at the size you want
served.

## Before you add a photograph of a real person

These pages are public marketing. A recognisable guest needs to have agreed to
appear here, and a verbal yes at a wedding is not a record of one.

The way to collect that properly is already built: **Featured Events**, which a
host reaches from their event's admin page. It records who agreed, to which
wording, on which day, and gives them something back for it. Photos that arrive
that way are safe to put in `gallery/`.
