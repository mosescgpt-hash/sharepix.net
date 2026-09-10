/**
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/build-site-images.mjs from the contents of
 * public/site/slots and public/site/gallery. To change what is here, add or
 * remove a photo in one of those folders and run `npm run images`.
 *
 * It is committed so a test can compare it against the folders; a manifest that
 * only existed at build time could go stale without anything noticing.
 */

/** Marketing photographs, keyed by the slot in lib/imagery.ts they fill. */
export const SLOT_FILES: Readonly<Record<string, string>> = {
  'home-hero': '/site/slots/home-hero.webp',
  'occasion-birthday': '/site/slots/occasion-birthday.webp',
  'occasion-corporate': '/site/slots/occasion-corporate.webp',
  'occasion-graduation': '/site/slots/occasion-graduation.webp',
  'occasion-holiday': '/site/slots/occasion-holiday.webp',
  'occasion-reunion': '/site/slots/occasion-reunion.webp',
  'occasion-wedding': '/site/slots/occasion-wedding.webp',
};

export interface GalleryFile {
  src: string;
  /** Derived from the filename. Rename the file to change it. */
  caption: string;
}

/**
 * The sample galleries, keyed by the event they belong to, each in folder
 * order. A key that is missing or empty falls back to generated tiles.
 */
export const GALLERY_SETS: Readonly<Record<string, readonly GalleryFile[]>> = {
  business: [
    { src: '/site/gallery/business/01-setting-up.webp', caption: "Setting up" },
    { src: '/site/gallery/business/02-first-visitors.webp', caption: "First visitors" },
    { src: '/site/gallery/business/03-the-demo.webp', caption: "The demo" },
    { src: '/site/gallery/business/04-a-closer-look.webp', caption: "A closer look" },
    { src: '/site/gallery/business/05-at-the-booth.webp', caption: "At the booth" },
    { src: '/site/gallery/business/06-getting-talking.webp', caption: "Getting talking" },
    { src: '/site/gallery/business/07-comparing-notes.webp', caption: "Comparing notes" },
    { src: '/site/gallery/business/08-on-the-screen.webp', caption: "On the screen" },
    { src: '/site/gallery/business/09-across-the-hall.webp', caption: "Across the hall" },
    { src: '/site/gallery/business/10-the-quiet-hour.webp', caption: "The quiet hour" },
    { src: '/site/gallery/business/11-a-group-shot.webp', caption: "A group shot" },
    { src: '/site/gallery/business/12-packing-down.webp', caption: "Packing down" },
  ],
  holiday: [
    { src: '/site/gallery/holiday/01-in-the-kitchen.webp', caption: "In the kitchen" },
    { src: '/site/gallery/holiday/02-the-tree.webp', caption: "The tree" },
    { src: '/site/gallery/holiday/03-the-cookies.webp', caption: "The cookies" },
    { src: '/site/gallery/holiday/04-a-quiet-moment.webp', caption: "A quiet moment" },
    { src: '/site/gallery/holiday/05-a-present-for-grandma.webp', caption: "A present for grandma" },
    { src: '/site/gallery/holiday/06-opening-presents.webp', caption: "Opening presents" },
    { src: '/site/gallery/holiday/07-the-photo-screen.webp', caption: "The photo screen" },
    { src: '/site/gallery/holiday/08-christmas-dinner.webp', caption: "Christmas dinner" },
    { src: '/site/gallery/holiday/09-photos-on-the-wall.webp', caption: "Photos on the wall" },
    { src: '/site/gallery/holiday/10-charades.webp', caption: "Charades" },
    { src: '/site/gallery/holiday/11-the-big-screen.webp', caption: "The big screen" },
    { src: '/site/gallery/holiday/12-all-of-us.webp', caption: "All of us" },
  ],
  wedding: [
    { src: '/site/gallery/wedding/01-the-vows.webp', caption: "The vows" },
    { src: '/site/gallery/wedding/02-with-the-newlyweds.webp', caption: "With the newlyweds" },
    { src: '/site/gallery/wedding/03-a-quiet-moment.webp', caption: "A quiet moment" },
    { src: '/site/gallery/wedding/04-the-reception.webp', caption: "The reception" },
    { src: '/site/gallery/wedding/05-at-the-table.webp', caption: "At the table" },
    { src: '/site/gallery/wedding/06-toasts.webp', caption: "Toasts" },
    { src: '/site/gallery/wedding/07-dinner.webp', caption: "Dinner" },
    { src: '/site/gallery/wedding/08-the-cake.webp', caption: "The cake" },
    { src: '/site/gallery/wedding/09-dessert.webp', caption: "Dessert" },
    { src: '/site/gallery/wedding/10-the-dance-floor.webp', caption: "The dance floor" },
    { src: '/site/gallery/wedding/11-on-the-big-screen.webp', caption: "On the big screen" },
    { src: '/site/gallery/wedding/12-the-farewell.webp', caption: "The farewell" },
  ],
};
