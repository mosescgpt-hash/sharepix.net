import { Head, Html, Main, NextScript } from 'next/document';

/**
 * Only here to set `lang` on <html>. Without it screen readers guess the
 * language and Lighthouse flags every page.
 */
export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
