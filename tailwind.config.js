/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
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
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      /**
       * Elevation, tinted navy rather than black. Three steps only — a card at
       * rest, a card being pointed at, and something that is meant to float
       * above the page. Flat hairline boxes on a flat background are the single
       * biggest reason a page reads as a template.
       */
      boxShadow: {
        card: '0 1px 2px rgba(18, 56, 81, 0.04), 0 10px 26px -14px rgba(18, 56, 81, 0.18)',
        lift: '0 2px 4px rgba(18, 56, 81, 0.05), 0 20px 44px -20px rgba(18, 56, 81, 0.28)',
        float: '0 32px 64px -32px rgba(11, 37, 54, 0.45)',
      },
    },
  },
  plugins: [],
};
