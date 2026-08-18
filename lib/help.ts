/**
 * Help-centre content.
 *
 * Kept as data rather than pages so the index, the search box, and the article
 * pages all read from one list — a new article is one entry here, not three
 * files to keep in step. `__tests__/help.test.ts` guards the invariants a
 * reader would notice: unique slugs, no dead "related" links, every article
 * reachable from a category.
 *
 * Written for the two audiences separately. A guest has no account and arrives
 * from a QR code; a host is signed in and is paying. Answering both in one
 * article makes each of them read past the half that is not about them.
 */

export type HelpAudience = 'guest' | 'host';

/** Where readers are told to write when an article cannot finish the job. */
export const SUPPORT_EMAIL = 'info@sharepix.net';

export type HelpBlock =
  | { kind: 'text'; text: string }
  | { kind: 'steps'; steps: string[] }
  | { kind: 'note'; text: string }
  /**
   * Renders as a mailto link. A block rather than an address typed into prose,
   * so the address lives in one constant and every "get in touch" is tappable
   * on a phone instead of something to copy out by hand.
   */
  | { kind: 'contact'; text: string };

export interface HelpArticle {
  slug: string;
  title: string;
  audience: HelpAudience;
  category: string;
  /** One sentence, shown on the index and in search results. */
  summary: string;
  /** Extra search terms — what someone types when they don't know our wording. */
  keywords: string[];
  blocks: HelpBlock[];
  related?: string[];
}

export const HELP_CATEGORIES = [
  'Adding photos and videos',
  'Finding and viewing photos',
  'Prints',
  'Running your event',
  'Plans, billing and add-ons',
  'Privacy and safety',
  'Your account',
] as const;

export const HELP_ARTICLES: HelpArticle[] = [
  // ── Adding photos and videos ───────────────────────────────────────────────
  {
    slug: 'add-photos',
    title: 'How to add photos and videos',
    audience: 'guest',
    category: 'Adding photos and videos',
    summary: 'Scan the QR code, pick your files, tap Upload. No app and no account needed.',
    keywords: ['upload', 'add', 'post', 'send', 'qr', 'scan', 'contribute'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Point your phone camera at the event QR code and open the link it offers.',
          'Optionally type your name, so the couple knows who took what.',
          'Tap Camera to take a photo now, or Choose from device to pick pictures and videos you already have.',
          'Tap Upload. Each file shows its progress, and you can keep adding more.',
        ],
      },
      {
        kind: 'text',
        text: 'Nothing to install and no sign-up. If you leave the page mid-upload, files that had already finished are safely stored; anything still in progress needs picking again.',
      },
      {
        kind: 'text',
        text: 'Photos appear in the shared gallery for everyone. Videos go to the host instead — you will not see your own clip in the gallery, and that is not a failed upload.',
      },
      {
        kind: 'note',
        text: 'No QR code handy? Ask the host for the event code and enter it on the sharepix.net home page.',
      },
    ],
    related: ['camera-opens-gallery', 'video-wont-upload', 'upload-failed'],
  },
  {
    slug: 'camera-opens-gallery',
    title: 'The Camera button opens my photo gallery',
    audience: 'guest',
    category: 'Adding photos and videos',
    summary: 'Older versions did this on some Android phones. It is fixed — and here is how to record video.',
    keywords: ['camera', 'gallery', 'android', 'pixel', 'iphone', 'record', 'take photo'],
    blocks: [
      {
        kind: 'text',
        text: 'The Camera button opens your camera to take a photo. If it opens your photo library instead, reload the page — an older version of the upload page had this problem on some Android phones, and a reload picks up the fix.',
      },
      {
        kind: 'text',
        text: 'To add a video, record it in your phone’s own camera app first, then come back and use Choose from device. The Camera button is for taking a picture; splitting it into two buttons made the page more confusing than it was worth.',
      },
    ],
    related: ['add-photos', 'video-wont-upload'],
  },
  {
    slug: 'video-wont-upload',
    title: 'My video will not upload',
    audience: 'guest',
    category: 'Adding photos and videos',
    summary: 'Almost always the file size or the event’s video allowance. Both say so on screen.',
    keywords: ['video', 'too large', 'size limit', 'mov', 'mp4', '4k', 'rejected', 'missing', 'not in gallery'],
    blocks: [
      {
        kind: 'text',
        text: 'Videos can be up to 250 MB each, in MP4, MOV, WEBM, M4V or 3GP. For scale, 250 MB is about a minute of 4K video, or four minutes at 1080p.',
      },
      {
        kind: 'text',
        text: 'If a clip is too big, film a shorter one, or lower your phone’s recording quality — Settings, then Camera, then Record Video on an iPhone. Dropping from 4K/60 to 1080p makes the file roughly four times smaller for the same length.',
      },
      {
        kind: 'text',
        text: 'You may also see a message that the event has no video slots left. Each plan includes a set number of videos, and the host can add more. Photos still upload normally when videos are full.',
      },
      {
        kind: 'note',
        text: 'ProRes recording produces enormous files — around 1.7 GB per minute — and will not fit. Turn it off before filming for an event.',
      },
    ],
    related: ['video-limits', 'add-photos', 'upload-failed'],
  },
  {
    slug: 'upload-failed',
    title: 'An upload failed or is stuck',
    audience: 'guest',
    category: 'Adding photos and videos',
    summary: 'Use Retry failed files. Venue wifi is the usual culprit.',
    keywords: ['failed', 'stuck', 'error', 'slow', 'wifi', 'retry', 'busy'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Tap Retry failed files at the bottom of the list, then Upload again.',
          'If several fail at once, wait a few seconds — that message means the service was briefly busy, and retrying works.',
          'On packed venue wifi, switching to mobile data is usually faster and more reliable.',
        ],
      },
      {
        kind: 'text',
        text: 'Uploads resume file by file, so anything that already succeeded is not sent twice. Photos marked "Already added" are duplicates the event has, not errors.',
      },
    ],
    related: ['duplicate-photos', 'add-photos'],
  },
  {
    slug: 'duplicate-photos',
    title: 'It says "Already added"',
    audience: 'guest',
    category: 'Adding photos and videos',
    summary: 'The same picture is already in the event, so it was skipped rather than stored twice.',
    keywords: ['duplicate', 'already added', 'skipped', 'same photo', 'twice'],
    blocks: [
      {
        kind: 'text',
        text: 'Every upload is fingerprinted, and an identical file that is already in the event is skipped. This keeps the gallery clean when several guests share the same picture in a group chat and each uploads it.',
      },
      {
        kind: 'text',
        text: 'A photo that has been edited, cropped or re-saved is a different file, so it uploads as a new one. Very large videos are not fingerprinted, so the same clip can be uploaded twice — ask the host to delete the extra.',
      },
    ],
    related: ['add-photos', 'host-delete-photo'],
  },
  {
    slug: 'iphone-heic',
    title: 'Uploading from an iPhone (HEIC photos and MOV video)',
    audience: 'guest',
    category: 'Adding photos and videos',
    summary: 'Both work as they are. There is nothing to convert first.',
    keywords: ['iphone', 'heic', 'heif', 'mov', 'apple', 'convert', 'ios'],
    blocks: [
      {
        kind: 'text',
        text: 'iPhone photos are usually HEIC and iPhone video is usually MOV. Both upload directly — no converting, no exporting, no changing your camera settings.',
      },
      {
        kind: 'text',
        text: 'If you would rather your phone produce the more universal formats anyway, set Settings, then Camera, then Formats to "Most Compatible". It is not required here.',
      },
    ],
    related: ['add-photos', 'photo-location-data'],
  },
  {
    slug: 'photo-limits',
    title: 'How many photos can be added?',
    audience: 'guest',
    category: 'Adding photos and videos',
    summary: 'It depends on the host’s plan — from 100 photos up to unlimited.',
    keywords: ['limit', 'how many', 'maximum', 'full', 'capacity'],
    blocks: [
      {
        kind: 'text',
        text: 'Each photo can be up to 25 MB, and the event holds between 100 photos and an unlimited number depending on the plan the host chose. Videos are counted separately.',
      },
      {
        kind: 'text',
        text: 'If an event is full you will see a message saying so. The host can add capacity, so it is worth telling them rather than giving up.',
      },
    ],
    related: ['video-limits', 'plans-compared'],
  },

  // ── Finding and viewing photos ─────────────────────────────────────────────
  {
    slug: 'find-the-gallery',
    title: 'How do I get back to the gallery?',
    audience: 'guest',
    category: 'Finding and viewing photos',
    summary: 'Scan the QR code again, or enter the event code on the home page.',
    keywords: ['find', 'gallery', 'link', 'event code', 'lost', 'back'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Scan the event QR code again — it always opens the same event.',
          'Or go to sharepix.net and enter the event code the host gave you.',
          'Bookmark the page, or add it to your home screen, so it is one tap next time.',
        ],
      },
    ],
    related: ['add-photos', 'photos-missing'],
  },
  {
    slug: 'photos-missing',
    title: 'My photo is not in the gallery',
    audience: 'guest',
    category: 'Finding and viewing photos',
    summary: 'Usually the upload did not finish, or the photo is briefly held for the host to check.',
    keywords: ['missing', 'not showing', 'disappeared', 'gone', 'held', 'review'],
    blocks: [
      {
        kind: 'text',
        text: 'First, pull the gallery to refresh. New uploads appear straight away for everyone.',
      },
      {
        kind: 'text',
        text: 'Some events check photos automatically for explicit content, and anything flagged is held for the host to look at before guests see it. The host can release it in one tap. This only applies to a small number of photos and never to ordinary party pictures — drinks, dancing and kissing are all fine.',
      },
      {
        kind: 'text',
        text: 'A photo can also be missing simply because its upload failed. If you still have the file, add it again.',
      },
    ],
    related: ['screening-explained', 'upload-failed'],
  },
  {
    slug: 'guest-download',
    title: 'Can I download the photos?',
    audience: 'guest',
    category: 'Finding and viewing photos',
    summary: 'Only if the host has turned guest downloads on for the event.',
    keywords: ['download', 'save', 'keep', 'copy', 'zip'],
    blocks: [
      {
        kind: 'text',
        text: 'Guest downloading is an optional extra the host buys per event. When it is on, you get download buttons on individual photos and can select several and take them as one ZIP file.',
      },
      {
        kind: 'text',
        text: 'Videos are the exception: they go to the host only. Guests can film and upload them, but they are not shown or downloadable in the guest gallery — ask the host if you want a copy.',
      },
      {
        kind: 'text',
        text: 'When it is off, you can still view everything — and you can ask the host, who can enable it at any time from their dashboard.',
      },
    ],
    related: ['host-guest-downloads', 'gallery-lifecycle'],
  },
  {
    slug: 'gallery-lifecycle',
    title: 'How long do the photos stay up?',
    audience: 'guest',
    category: 'Finding and viewing photos',
    summary: 'Uploads run for 30 days, then viewing continues for a while, then the gallery closes.',
    keywords: ['how long', 'expire', 'deleted', 'closed', 'window', 'access'],
    blocks: [
      {
        kind: 'text',
        text: 'Guests can add photos for 30 days from when the event is created, and the host can extend that. After the upload window closes, guests keep viewing the gallery for a further period set by the plan — three weeks on Starter, 30 days on the others.',
      },
      {
        kind: 'text',
        text: 'After that, guest viewing ends but the host still has full access and downloads for months, so ask them if you need a picture later. Download anything you want to keep while the gallery is open.',
      },
    ],
    related: ['guest-download', 'host-extend-window'],
  },

  // ── Prints ─────────────────────────────────────────────────────────────────
  {
    slug: 'order-prints',
    title: 'Ordering prints of a photo',
    audience: 'guest',
    category: 'Prints',
    summary: 'Pick photos, choose a size, pay by card. They are printed and posted to you.',
    keywords: ['print', 'order', 'buy', 'photo print', 'framed', 'delivery'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Open the gallery and select the photo or photos you want.',
          'Choose Order prints, then pick a size and how many copies.',
          'Pay by card and enter the delivery address at checkout.',
        ],
      },
      {
        kind: 'text',
        text: 'Sizes are 4×6, 5×7 and 8×10 photo prints, an 11×14 fine-art print, and a 12×16 framed print. Extra copies of photo prints ship free in the same order, so ordering several at once costs less than ordering one at a time.',
      },
      {
        kind: 'note',
        text: 'Prints are only offered on events where the host has enabled guest downloads. Videos cannot be printed.',
      },
    ],
    related: ['print-problem', 'guest-download'],
  },
  {
    slug: 'print-problem',
    title: 'A problem with a print order',
    audience: 'guest',
    category: 'Prints',
    summary: 'Wrong, damaged or missing prints — what to have ready when you get in touch.',
    keywords: ['refund', 'damaged', 'wrong', 'missing', 'late', 'shipping', 'tracking'],
    blocks: [
      {
        kind: 'text',
        text: 'Prints are produced and posted by our print partner, usually within a few days of ordering, and delivery time depends on your address.',
      },
      {
        kind: 'contact',
        text: 'If an order arrives damaged, is wrong, or does not arrive, email us with the address you used at checkout and the approximate order date. A photo of the problem helps a replacement go through quickly.',
      },
      {
        kind: 'note',
        text: 'Orders go to production quickly, so a cancellation has to be immediate. Once printing has started it cannot be stopped.',
      },
    ],
    related: ['order-prints'],
  },

  // ── Running your event ─────────────────────────────────────────────────────
  {
    slug: 'create-event',
    title: 'Creating an event',
    audience: 'host',
    category: 'Running your event',
    summary: 'Name it, pick a plan, pay — the QR code is ready immediately.',
    keywords: ['create', 'new event', 'start', 'set up', 'wedding'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Sign in, then choose Create event.',
          'Enter the event name and date, and pick a plan.',
          'Pay by card. The event goes live as soon as payment completes.',
          'Open your dashboard and choose Show QR code.',
        ],
      },
      {
        kind: 'note',
        text: 'The name and date lock once the first photo is uploaded, so guests never see the event rename itself underneath them. Get them right before you share the code.',
      },
    ],
    related: ['share-qr-code', 'plans-compared', 'event-not-active'],
  },
  {
    slug: 'share-qr-code',
    title: 'Sharing your QR code with guests',
    audience: 'host',
    category: 'Running your event',
    summary: 'Show it on screen, print the brochure for tables, or send the event code.',
    keywords: ['qr', 'code', 'share', 'invite', 'sign', 'table', 'brochure', 'print'],
    blocks: [
      {
        kind: 'text',
        text: 'Your dashboard has Show QR code, which you can display on a phone or download as an image for a sign. Every plan above Starter lets you restyle the code to match your event.',
      },
      {
        kind: 'text',
        text: 'Printable brochure produces a page ready for a table or an order of service, with the code and short instructions already on it.',
      },
      {
        kind: 'text',
        text: 'Guests without a camera-scannable code can go to sharepix.net and type the event code shown on your dashboard.',
      },
    ],
    related: ['create-event', 'guests-cant-upload'],
  },
  {
    slug: 'host-extend-window',
    title: 'Giving guests more time to upload',
    audience: 'host',
    category: 'Running your event',
    summary: 'Extend the upload window by 30 days for half your plan price.',
    keywords: ['extend', 'more time', 'window', 'closed', 'reopen', 'deadline'],
    blocks: [
      {
        kind: 'text',
        text: 'The upload window runs 30 days from when the event was created. On your dashboard, tick Extend upload window in the Add-ons list and pay once — it adds another 30 days, and you can do it more than once.',
      },
      {
        kind: 'text',
        text: 'Extending also pushes back everything that follows: how long guests can view, and how long you keep full access.',
      },
    ],
    related: ['gallery-lifecycle', 'host-close-event', 'add-ons'],
  },
  {
    slug: 'host-close-event',
    title: 'Closing an event early',
    audience: 'host',
    category: 'Running your event',
    summary: 'Stops new uploads while keeping the gallery viewable.',
    keywords: ['close', 'stop', 'end', 'lock', 'finish'],
    blocks: [
      {
        kind: 'text',
        text: 'Closing the event stops guests adding anything new but leaves everything already uploaded visible to them. It is reversible while the upload window is still running.',
      },
      {
        kind: 'text',
        text: 'Use it when the event is over and you would rather the gallery stopped growing — for instance before you sit down to pick favourites.',
      },
    ],
    related: ['host-extend-window', 'host-delete-photo'],
  },
  {
    slug: 'host-delete-photo',
    title: 'Deleting a photo, or the whole event',
    audience: 'host',
    category: 'Running your event',
    summary: 'Hosts can remove anything. Deleting an event is permanent.',
    keywords: ['delete', 'remove', 'hide', 'take down', 'inappropriate'],
    blocks: [
      {
        kind: 'text',
        text: 'From your dashboard you can delete any photo or video in the event, whoever uploaded it. Deleting frees the slot, so removing a video makes room for another one.',
      },
      {
        kind: 'text',
        text: 'Deleting the event removes every photo with it and cannot be undone. You are asked to confirm, and the confirmation tells you how many photos will go.',
      },
      {
        kind: 'note',
        text: 'Download anything you want to keep first. There is no undo and no recovery after deletion.',
      },
    ],
    related: ['host-download-all', 'host-close-event'],
  },
  {
    slug: 'host-download-all',
    title: 'Downloading everything as a host',
    audience: 'host',
    category: 'Running your event',
    summary: 'Select photos and take them as a ZIP, at full quality.',
    keywords: ['download', 'zip', 'bulk', 'save', 'export', 'backup', 'all'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Open your event dashboard and scroll to the photos.',
          'Select the ones you want, or select all.',
          'Choose the download option and wait for the ZIP to build.',
        ],
      },
      {
        kind: 'text',
        text: 'You get the original files, not the smaller versions guests see on screen.',
      },
      {
        kind: 'note',
        text: 'The ZIP is assembled in your browser, so an event with many long videos can exhaust its memory. If a large download fails, take it in two or three smaller selections, or use a laptop rather than a phone.',
      },
    ],
    related: ['host-delete-photo', 'gallery-lifecycle'],
  },
  {
    slug: 'guests-cant-upload',
    title: 'Guests say they cannot upload',
    audience: 'host',
    category: 'Running your event',
    summary: 'Work through the four things that stop uploads, in order.',
    keywords: ['guests', 'cannot upload', 'not working', 'broken', 'troubleshoot'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Check the event is active — an unpaid event refuses uploads until payment completes.',
          'Check the upload window is still open. The date is on your dashboard, and you can extend it.',
          'Check you have not closed the event, which stops new uploads deliberately.',
          'Check the photo or video allowance is not full. Deleting frees slots.',
        ],
      },
      {
        kind: 'text',
        text: 'If none of those apply, ask the guest what the message on screen said — the upload page explains the specific reason it refused a file.',
      },
    ],
    related: ['event-not-active', 'video-limits', 'host-extend-window'],
  },
  {
    slug: 'event-not-active',
    title: 'My event says it is not active yet',
    audience: 'host',
    category: 'Running your event',
    summary: 'Payment has not completed. It usually clears within a minute.',
    keywords: ['not active', 'pending', 'payment', 'unpaid', 'stuck'],
    blocks: [
      {
        kind: 'text',
        text: 'An event is created before payment finishes, so there is a short window where it exists but cannot accept uploads. It activates automatically once the card payment confirms — normally within a minute.',
      },
      {
        kind: 'text',
        text: 'If it is still inactive after a few minutes, check your card statement.',
      },
      {
        kind: 'contact',
        text: 'If you were charged and the event has not activated, email us with the event name and we will activate it.',
      },
      {
        kind: 'note',
        text: 'Do not create a second event to work around this — it will charge you twice.',
      },
    ],
    related: ['create-event', 'billing-help'],
  },

  // ── Screening and safety ───────────────────────────────────────────────────
  {
    slug: 'screening-explained',
    title: 'How photo screening works',
    audience: 'host',
    category: 'Privacy and safety',
    summary: 'Explicit photos are held for you to check before guests ever see them.',
    keywords: ['screening', 'moderation', 'flagged', 'held', 'explicit', 'review', 'approve'],
    blocks: [
      {
        kind: 'text',
        text: 'Every uploaded photo is checked automatically before it appears. Anything flagged is hidden from guests and from the live slideshow, and waits on your dashboard with a Release button.',
      },
      {
        kind: 'text',
        text: 'The check is deliberately narrow: explicit sexual content and nudity only. Alcohol, cigars, kissing, swimwear and dancing are never flagged, because an alert that fires on ordinary wedding photos is an alert you learn to ignore.',
      },
      {
        kind: 'text',
        text: 'You can switch screening off in Event settings if you would rather everything appear immediately. Videos are not screened either way — turn video off if you want screened media only.',
      },
    ],
    related: ['screening-alerts', 'host-video-off', 'host-delete-photo'],
  },
  {
    slug: 'screening-alerts',
    title: 'Getting emailed when a photo is held',
    audience: 'host',
    category: 'Privacy and safety',
    summary: 'Add an address and you get the photo plus Approve and Deny buttons.',
    keywords: ['email', 'alert', 'notify', 'held', 'approve', 'deny', 'notification'],
    blocks: [
      {
        kind: 'text',
        text: 'In Event settings, enter an address under "Email me when a photo is held". You will get a message with the photo shown inside it, so you can judge without opening anything.',
      },
      {
        kind: 'text',
        text: 'The Approve and Deny buttons open a page that asks you to confirm rather than acting immediately. That is deliberate — email scanners follow links, and a one-click approval could be triggered by software before a person ever looked.',
      },
      {
        kind: 'note',
        text: 'Leaving the address blank simply means no emails. Held photos still wait on your dashboard either way.',
      },
    ],
    related: ['screening-explained'],
  },
  {
    slug: 'host-video-off',
    title: 'Turning video off for an event',
    audience: 'host',
    category: 'Privacy and safety',
    summary: 'Photos only, in one tap — useful if you want everything screened.',
    keywords: ['video off', 'photos only', 'disable video', 'no video'],
    blocks: [
      {
        kind: 'text',
        text: 'Event settings has a video switch. With it off, guests are told the event accepts photos only, and the upload page stops offering video.',
      },
      {
        kind: 'text',
        text: 'The main reason to use it is screening: automatic checks cover photos but not video, so an event that must be screened end to end should be photos only.',
      },
    ],
    related: ['screening-explained', 'video-limits'],
  },
  {
    slug: 'photo-location-data',
    title: 'Do photos share where they were taken?',
    audience: 'guest',
    category: 'Privacy and safety',
    summary: 'No. GPS coordinates are stripped from uploads automatically.',
    keywords: ['gps', 'location', 'exif', 'metadata', 'privacy', 'tracking'],
    blocks: [
      {
        kind: 'text',
        text: 'Phone photos usually record the exact coordinates where they were taken. Every upload here has that location data removed automatically, so it is not in the file even if someone downloads the original.',
      },
      {
        kind: 'text',
        text: 'Photos keep the orientation information they need to display the right way up, and JPEGs additionally lose camera details, timestamps and any embedded thumbnail.',
      },
    ],
    related: ['who-can-see', 'iphone-heic'],
  },
  {
    slug: 'who-can-see',
    title: 'Who can see what I upload?',
    audience: 'guest',
    category: 'Privacy and safety',
    summary: 'Everyone with the event code, and the host. It is a shared album, not a private one.',
    keywords: ['privacy', 'who can see', 'public', 'private', 'visible', 'delete mine'],
    blocks: [
      {
        kind: 'text',
        text: 'Photos you upload are visible to other guests at that event and to the host. Galleries are not indexed or searchable, but anyone with the code or QR image can open one — treat a photo as sharing with everyone at the party.',
      },
      {
        kind: 'text',
        text: 'Videos are different: only the host sees them. A clip you upload goes to the couple and is not shown to other guests at all.',
      },
      {
        kind: 'text',
        text: 'If you want something taken down, ask the host: they can delete any photo in their event.',
      },
    ],
    related: ['photo-location-data', 'host-delete-photo'],
  },

  // ── Plans, billing and add-ons ─────────────────────────────────────────────
  {
    slug: 'plans-compared',
    title: 'Which plan do I need?',
    audience: 'host',
    category: 'Plans, billing and add-ons',
    summary: 'The differences are capacity, how long access lasts, and a few extra features.',
    keywords: ['plan', 'pricing', 'compare', 'tier', 'starter', 'standard', 'premium', 'cost'],
    blocks: [
      {
        kind: 'text',
        text: 'Starter suits a small party: 100 photos, 2 videos, and three weeks of viewing after uploads close. Standard suits most weddings: 1,000 photos, 10 videos, and three months of host access. Premium adds unlimited photos, 30 videos, event branding, and a year of access.',
      },
      {
        kind: 'text',
        text: 'Every plan has the same 30-day upload window and the same QR code sharing. The live slideshow can be added to any plan.',
      },
      {
        kind: 'text',
        text: 'Running several events at once is what the Corporate plan is for — a monthly subscription covering multiple active events under one account.',
      },
    ],
    related: ['video-limits', 'add-ons', 'corporate-plan'],
  },
  {
    slug: 'video-limits',
    title: 'How many videos does my plan include?',
    audience: 'host',
    category: 'Plans, billing and add-ons',
    summary: 'Two on Starter, ten on Standard, thirty on Premium and Corporate.',
    keywords: ['video limit', 'how many videos', 'allowance', 'video slots', 'full'],
    blocks: [
      {
        kind: 'text',
        text: 'Videos are counted separately from photos, and each can be up to 250 MB. Your dashboard shows how many have been used.',
      },
      {
        kind: 'text',
        text: 'Photos can be unlimited on the higher plans, but video cannot: a photo is shrunk before it is ever shown, while a video is sent in full every time somebody plays it. The allowance is what keeps that predictable.',
      },
      {
        kind: 'text',
        text: 'For the same reason, videos are yours alone. Guests can film and upload them, but only you can watch and download them — a hundred guests replaying each other’s clips is the one cost in the product with no ceiling on it.',
      },
      {
        kind: 'text',
        text: 'Deleting a video frees its slot immediately. Events created before video allowances existed are not affected by them.',
      },
    ],
    related: ['video-wont-upload', 'plans-compared', 'host-video-off'],
  },
  {
    slug: 'add-ons',
    title: 'Add-ons, and how to buy them',
    audience: 'host',
    category: 'Plans, billing and add-ons',
    summary: 'Tick what you want on your dashboard and pay for all of it at once.',
    keywords: ['add-on', 'addon', 'extras', 'buy', 'upgrade', 'slideshow', 'downloads'],
    blocks: [
      {
        kind: 'text',
        text: 'Add-ons sit in one list on your dashboard: extend the upload window, guest downloads, and the live slideshow. Tick everything you want, apply a discount code if you have one, and pay with a single checkout.',
      },
      {
        kind: 'text',
        text: 'A discount code applies to whichever ticked items it covers; anything it does not cover stays full price, and the total updates before you pay.',
      },
      {
        kind: 'text',
        text: 'Anything already bought is shown as included rather than offered again.',
      },
    ],
    related: ['host-guest-downloads', 'live-slideshow', 'discount-codes'],
  },
  {
    slug: 'host-guest-downloads',
    title: 'Letting guests download photos',
    audience: 'host',
    category: 'Plans, billing and add-ons',
    summary: 'A per-event add-on that also unlocks print ordering and download QR codes.',
    keywords: ['guest download', 'let guests save', 'download qr', 'share link', 'unlock'],
    blocks: [
      {
        kind: 'text',
        text: 'Buy Guest downloads from the Add-ons list and guests get download buttons plus bulk ZIP downloads. It also enables print ordering for guests.',
      },
      {
        kind: 'text',
        text: 'You can additionally build a download QR code for a chosen selection of photos — handy for sending a specific set to family without giving them the whole gallery.',
      },
    ],
    related: ['add-ons', 'order-prints', 'guest-download'],
  },
  {
    slug: 'live-slideshow',
    title: 'Running the live slideshow at your venue',
    audience: 'host',
    category: 'Plans, billing and add-ons',
    summary: 'Photos appear on a screen as guests upload them, with a short safety delay.',
    keywords: ['slideshow', 'screen', 'projector', 'tv', 'live', 'display', 'venue'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Buy the Live slideshow add-on from your dashboard.',
          'On the machine driving the screen, sign in and open your event dashboard.',
          'Choose Live slideshow — it opens in its own tab.',
          'Put that tab full screen and leave it running.',
        ],
      },
      {
        kind: 'text',
        text: 'Each photo shows for a few seconds, new arrivals jump the queue so guests see their picture while they are still standing there, and the reel loops. It checks for new photos continuously — nothing to refresh.',
      },
      {
        kind: 'text',
        text: 'Photos wait about 90 seconds before they can appear. That is the screening window, so nothing reaches a large screen the instant it lands. Videos are never shown, and held photos never appear.',
      },
      {
        kind: 'note',
        text: 'Set the screen’s machine not to sleep, and check the venue wifi reaches it before the day.',
      },
    ],
    related: ['screening-explained', 'add-ons', 'slideshow-blank'],
  },
  {
    slug: 'slideshow-blank',
    title: 'The slideshow is blank or has stopped',
    audience: 'host',
    category: 'Plans, billing and add-ons',
    summary: 'Usually the 90-second delay, an empty event, or the screen going to sleep.',
    keywords: ['slideshow', 'blank', 'not working', 'stopped', 'frozen', 'black screen'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Wait 90 seconds after the first upload — photos are held briefly before they can appear.',
          'Check the event actually has photos, and that they are not all held for review.',
          'Check the machine has not gone to sleep or locked its screen.',
          'Reload the tab. The reel rebuilds from scratch within a few seconds.',
        ],
      },
      {
        kind: 'text',
        text: 'A brief network drop does not stop the show — it keeps playing the photos it already has and picks up new ones when the connection returns.',
      },
    ],
    related: ['live-slideshow'],
  },
  {
    slug: 'discount-codes',
    title: 'Using a discount code',
    audience: 'host',
    category: 'Plans, billing and add-ons',
    summary: 'Enter it at checkout, or in the Add-ons box on your dashboard.',
    keywords: ['discount', 'code', 'coupon', 'promo', 'voucher', 'not working'],
    blocks: [
      {
        kind: 'text',
        text: 'There is a discount box on the plan checkout and another beside the Add-ons list. Codes are not case-sensitive, and the price updates before you pay so you can see it applied.',
      },
      {
        kind: 'text',
        text: 'A code that is refused has usually expired, run out of uses, or does not cover the item you ticked. Codes are often restricted to particular plans or add-ons — the total will show which parts it applied to.',
      },
    ],
    related: ['add-ons', 'billing-help'],
  },
  {
    slug: 'corporate-plan',
    title: 'The Corporate plan and managing the subscription',
    audience: 'host',
    category: 'Plans, billing and add-ons',
    summary: 'A monthly plan for running multiple events, cancellable yourself at any time.',
    keywords: ['corporate', 'business', 'subscription', 'monthly', 'cancel', 'billing portal'],
    blocks: [
      {
        kind: 'text',
        text: 'Corporate is a monthly subscription covering multiple active events under one account, each with unlimited photos, 30 videos, company branding and a central dashboard.',
      },
      {
        kind: 'text',
        text: 'Use the billing portal link on your dashboard to update your card, see invoices, or cancel. Cancelling leaves 30 days to download after your last paid month.',
      },
    ],
    related: ['plans-compared', 'billing-help'],
  },
  {
    slug: 'billing-help',
    title: 'Receipts, charges and refunds',
    audience: 'host',
    category: 'Plans, billing and add-ons',
    summary: 'Where the receipt comes from, and what to do about an unexpected charge.',
    keywords: ['receipt', 'invoice', 'refund', 'charged twice', 'payment', 'card'],
    blocks: [
      {
        kind: 'text',
        text: 'Payments are handled by Stripe, and the card receipt comes from them. Corporate subscribers can see every invoice in the billing portal.',
      },
      {
        kind: 'contact',
        text: 'If you think you were charged twice — for instance after a browser back button during checkout — email us with the event name and the approximate time, and we will check and refund any duplicate.',
      },
      {
        kind: 'note',
        text: 'A pending event that never activated is not a charge. Check the card statement before paying again.',
      },
    ],
    related: ['event-not-active', 'corporate-plan'],
  },

  // ── Your account ───────────────────────────────────────────────────────────
  {
    slug: 'reset-password',
    title: 'I cannot sign in',
    audience: 'host',
    category: 'Your account',
    summary: 'Use the password reset on the sign-in screen; it also clears a lockout.',
    keywords: ['password', 'forgot', 'reset', 'locked out', 'sign in', 'login'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'On the sign-in screen, choose the forgotten-password option.',
          'Enter the email address you signed up with.',
          'Use the code that arrives to set a new password.',
        ],
      },
      {
        kind: 'text',
        text: 'If the email does not arrive, check spam, and confirm you are using the address you originally signed up with.',
      },
      {
        kind: 'contact',
        text: 'Still stuck? Email us from the address on the account and we can send a reset.',
      },
      {
        kind: 'note',
        text: 'Guests never need an account, so this only applies to hosts.',
      },
    ],
    related: ['mfa-setup'],
  },
  {
    slug: 'mfa-setup',
    title: 'Turning on two-factor authentication',
    audience: 'host',
    category: 'Your account',
    summary: 'Add an authenticator app so a password alone is not enough.',
    keywords: ['mfa', '2fa', 'two factor', 'authenticator', 'security', 'totp'],
    blocks: [
      {
        kind: 'steps',
        steps: [
          'Sign in and open the Security page.',
          'Choose to set up authenticator-app MFA.',
          'Scan the code with an authenticator app and enter the six-digit number it shows.',
        ],
      },
      {
        kind: 'text',
        text: 'From then on, signing in asks for a code from the app as well as your password. Worth doing if your account holds events you cannot afford to lose access to.',
      },
      {
        kind: 'note',
        text: 'Keep the authenticator app backed up. Losing the device it is on makes signing in much harder.',
      },
    ],
    related: ['reset-password'],
  },
  {
    slug: 'install-app',
    title: 'Adding sharepix to your home screen',
    audience: 'guest',
    category: 'Your account',
    summary: 'It works in the browser, but it can sit on your home screen like an app.',
    keywords: ['install', 'app', 'home screen', 'pwa', 'shortcut', 'download app'],
    blocks: [
      {
        kind: 'text',
        text: 'There is no app to download — everything runs in your phone’s browser. If you would rather have an icon, most browsers offer an install or "Add to Home Screen" option, and there is a button on the site when your browser supports it.',
      },
      {
        kind: 'text',
        text: 'On an iPhone, use the share button in Safari and choose Add to Home Screen.',
      },
    ],
    related: ['find-the-gallery'],
  },
];

/** Articles in a category, in the order they are declared. */
export function articlesInCategory(category: string): HelpArticle[] {
  return HELP_ARTICLES.filter((article) => article.category === category);
}

export function findArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

/**
 * Match against title, summary and keywords. Every word typed has to match
 * something, so "video size" narrows rather than returning both topics.
 */
export function searchHelp(query: string): HelpArticle[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return HELP_ARTICLES.filter((article) => {
    const haystack = [
      article.title,
      article.summary,
      article.category,
      ...article.keywords,
    ]
      .join(' ')
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
