/**
 * Where a host can buy NFC stickers for the "or tap here" mark.
 *
 * SharePix does not sell these; the links go to a retailer. This is the one
 * place to change them — swap in an affiliate link or a SharePix store here and
 * every page that offers stickers follows.
 *
 * Search results rather than a single listing on purpose: a specific product
 * goes out of stock or disappears, and a dead "Order" button is worse than a
 * page of equivalent stickers.
 */

export interface NfcStoreLink {
  label: string;
  detail: string;
  url: string;
}

export const NFC_STORE_NAME = 'Amazon';

/**
 * Set true if any link below earns SharePix a commission. The card then says
 * so, as US (FTC) rules require; while false it says the link is unpaid.
 */
export const NFC_STORE_AFFILIATE = false;

export const NFC_STORE_LINKS: readonly NfcStoreLink[] = [
  {
    label: 'NFC stickers',
    detail: 'NTAG215, for card, wood, acrylic and glass.',
    url: 'https://www.amazon.com/s?k=NTAG215+NFC+stickers',
  },
  {
    label: 'On-metal NFC stickers',
    detail: 'NTAG215 on-metal, for metal stands and frames.',
    url: 'https://www.amazon.com/s?k=NTAG215+on-metal+NFC+stickers',
  },
];
