/**
 * The three-step explanation of how SharePix works.
 *
 * Pulled out of the homepage so every page that needs it — the homepage
 * itself, and each use-case landing page — renders the exact same three
 * sentences. Before this, a second "how it works" would have been typed out
 * by hand on each landing page and drifted from the homepage's the first
 * time either one was edited.
 */
export interface HowItWorksStep {
  n: string;
  title: string;
  body: string;
}

export const HOW_IT_WORKS_STEPS: HowItWorksStep[] = [
  {
    n: '01',
    title: 'Create your event',
    body: 'Name it, pick a date, choose a plan. We generate your QR code and a gallery link straight away.',
  },
  {
    n: '02',
    title: 'Guests scan and share',
    body: 'They point a phone camera at the code. The upload page opens in the browser — no app, no sign-up, nothing to explain.',
  },
  {
    n: '03',
    title: 'Download everything',
    body: 'Full-resolution originals in one ZIP whenever you are ready, and your guests can take theirs too.',
  },
];
