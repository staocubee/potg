import { Html, Head, Main, NextScript } from "next/document";

// Didn't exist before this redesign — the app had no viewport meta tag at
// all, so every mobile browser was rendering the desktop layout zoomed out
// instead of at device width. Everything else here is Next.js boilerplate.
//
// Deliberately does NOT load next/font here: next/font's CSS module only
// gets bundled when used from _app.tsx, page files, or regular components
// — using it in _document.tsx silently produces an empty custom property
// (confirmed live: getComputedStyle(...).getPropertyValue('--font-inter')
// came back "" here, which in turn made `body`'s var(--potg-font) resolve
// to nothing and fall all the way back to the browser's serif default).
// The font is applied in pages/_app.tsx instead.
export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0f2942" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
