/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    // lib/imagery.ts holds complete class strings for placeholder tints, and
    // Tailwind only emits classes it can see in the scanned source.
    './lib/**/*.{js,ts}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#123851',    // SharePix navy (from brand logo)
        night: '#0B2536',  // darker navy for hover states
        smoke: '#F4F6F5',  // light page background
        card: '#FFFFFF',
        accent: '#099361', // brand green (play mark) — readable on white
        mint: '#7AD8C0',   // brand mint — highlights and badges
        // A hairline that is a *colour*, not ink at 10% opacity. Opacity
        // borders wash out over the page gradient and read as unfinished;
        // this one holds its weight wherever it lands.
        line: '#E3E9EA',
        // Secondary text at AA on white (4.7:1). `text-ink/60` is only ~3.9:1,
        // which is both a contrast failure and the specific greyness that makes
        // body copy look like placeholder text.
        muted: '#5A7284',

        // ---------------------------------------------------------------
        // Redesign palette (docs/design-system.md). ADDITIVE: the tokens
        // above still drive every live page until Phase 3 migrates them,
        // so both sets coexist deliberately.
        //
        // The brand navy and mint are UNCHANGED — `ink` is the deep colour
        // for inverted sections and primary buttons, `mint` is the accent
        // on top of it. What the redesign adds is a *warm* ground in place
        // of `smoke`: the reference's expensive feel comes from the paper,
        // not from its green. See the palette comparison that chose this.
        // ---------------------------------------------------------------
        canvas: '#FAF8F4',   // warm off-white page background (replaces smoke)
        sand: '#F0EBE3',     // alternate section background, a shade warmer
        charcoal: '#152833', // headlines and body: near-black, navy cast
        // `accent` (#099361) is only 3.3:1 on canvas — fine as a fill behind
        // white, a contrast failure for 11px eyebrow labels. `pine` is the
        // same green darkened until small text on canvas clears AA (5.0:1).
        pine: '#0B7A52',
        sage: '#DCEAE4',     // soft circles behind step icons
        paper: '#FFFFFF',    // panels that lift off canvas
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
        // Redesign pairing. `sans` carries headline line one and all UI;
        // `serif` is used ITALIC for headline line two, occasion labels and
        // numerals — that pairing is the brand. See docs/design-system.md.
        sans: ['"Poppins"', 'system-ui', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
      },
      /**
       * Elevation, tinted navy rather than black. Three steps only — a card at
       * rest, a card being pointed at, and something that is meant to float
       * above the page. Flat hairline boxes on a flat background are the single
       * biggest reason a page reads as a template.
       */
      borderRadius: {
        // The reference has no rounding anywhere except the hero arch.
        arch: '999px 999px 0 0',
      },
      boxShadow: {
        card: '0 1px 2px rgba(18, 56, 81, 0.04), 0 10px 26px -14px rgba(18, 56, 81, 0.18)',
        lift: '0 2px 4px rgba(18, 56, 81, 0.05), 0 20px 44px -20px rgba(18, 56, 81, 0.28)',
        float: '0 32px 64px -32px rgba(11, 37, 54, 0.45)',
      },
    },
  },
  plugins: [],
};
