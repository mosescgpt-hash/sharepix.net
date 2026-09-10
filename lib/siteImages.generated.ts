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

/** The sample gallery, in folder order. Empty means fall back to generated tiles. */
export const GALLERY_FILES: readonly GalleryFile[] = [
  { src: '/site/gallery/01-the-vows.webp', caption: "The vows" },
  { src: '/site/gallery/02-with-the-newlyweds.webp', caption: "With the newlyweds" },
  { src: '/site/gallery/03-a-quiet-moment.webp', caption: "A quiet moment" },
  { src: '/site/gallery/04-the-reception.webp', caption: "The reception" },
  { src: '/site/gallery/05-at-the-table.webp', caption: "At the table" },
  { src: '/site/gallery/06-toasts.webp', caption: "Toasts" },
  { src: '/site/gallery/07-dinner.webp', caption: "Dinner" },
  { src: '/site/gallery/08-the-cake.webp', caption: "The cake" },
  { src: '/site/gallery/09-dessert.webp', caption: "Dessert" },
  { src: '/site/gallery/10-the-dance-floor.webp', caption: "The dance floor" },
  { src: '/site/gallery/11-on-the-big-screen.webp', caption: "On the big screen" },
  { src: '/site/gallery/12-the-farewell.webp', caption: "The farewell" },
];
