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
        // The palette (docs/design-system.md). The brand navy and mint are
        // unchanged from the logo; what the redesign added is a *warm* ground
        // in place of the old cool `smoke`, because the expensive feel of the
        // reference comes from its paper, not from its green.
        //
        // The old cool-grey set (smoke, card, line, muted, accent) was removed
        // after Phase 5, once no page referenced it.
        ink: '#123851',      // SharePix navy: inverted sections, primary buttons
        night: '#0B2536',    // darker navy for hover states
        mint: '#7AD8C0',     // brand mint: accent text and badges ON navy
        canvas: '#FAF8F4',   // warm off-white page background
        sand: '#F0EBE3',     // alternate section background, a shade warmer
        charcoal: '#152833', // headlines and body: near-black, navy cast
        // The brand green (#099361) is only 3.3:1 on canvas — fine as a fill
        // behind white, a contrast failure for an 11px eyebrow label. `pine`
        // is that green darkened until small text on canvas clears AA (5.0:1).
        pine: '#0B7A52',
        sage: '#DCEAE4',     // soft circles behind step icons
        paper: '#FFFFFF',    // panels that lift off canvas
      },
      fontFamily: {
        // `sans` carries headline line one and all UI; `serif` is used ITALIC
        // for headline line two, occasion labels and numerals — that pairing is
        // the brand. See docs/design-system.md.
        sans: ['"Poppins"', 'system-ui', 'sans-serif'],
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
      },
      borderRadius: {
        // The one rounded shape in the system.
        arch: '999px 999px 0 0',
      },
      // No `boxShadow` extensions. Separation here is background colour and
      // hairlines, never elevation — the three-step navy-tinted shadow ramp
      // went with the old system.
    },
  },
  plugins: [],
};
