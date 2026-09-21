import { Html, Head, Main, NextScript } from "next/document";

// Everything else here is Next.js boilerplate.
//
// Deliberately does NOT set the viewport meta tag here, and does NOT load
// next/font here — both are unsupported in _document.tsx even though
// nothing stops you from writing them:
// - The viewport meta tag belongs in pages/_app.tsx's own <Head> instead.
//   Next.js warns at runtime if it's placed here ("viewport meta tags
//   should not be used in _document.js's <Head>") because _document only
//   controls the static document shell, not the per-request <head> Next
//   itself manages — putting it here produced a real, live bug: a second,
//   conflicting viewport tag plus (observed after a dev-server restart)
//   client-side hydration/navigation silently getting stuck on every page,
//   not just a console warning.
// - next/font's CSS module doesn't get bundled when used in _document.tsx
//   (confirmed live: getComputedStyle(...).getPropertyValue('--font-inter')
//   came back "" here, which made `body`'s var(--potg-font) resolve to
//   nothing and fall back to the browser's serif default).
// Both are applied in pages/_app.tsx instead.
export default function Document() {
  return (
    <Html lang="en">
      {/* Static, same on every page — exactly what _document.tsx (as
          opposed to _app.tsx) is for, unlike the viewport meta tag and
          next/font above. */}
      <Head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
