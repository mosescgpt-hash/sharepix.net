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
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
