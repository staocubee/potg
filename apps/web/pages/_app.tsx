import type { AppProps } from "next/app";
import { AuthProvider } from "../lib/auth";
import { ToastProvider } from "../components/Toast";
import { inter, fraunces } from "../lib/fonts";
import "../styles/globals.css";

// Self-hosted via next/font (no runtime Google Fonts request, no
// flash-of-unstyled-text) instead of the old per-page <Head> link-tag
// approach. `inter.className` sets a real font-family on this wrapper
// directly (not just a CSS variable), so it reliably cascades to every
// descendant — i.e. the entire app, since nothing renders visible text as
// a direct child of <body> outside this tree. `.variable` on both fonts
// additionally exposes --font-inter/--font-fraunces for anything that
// explicitly references var(--potg-font)/var(--potg-font-display).
export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${inter.className} ${inter.variable} ${fraunces.variable}`}>
      <AuthProvider>
        <ToastProvider>
          <Component {...pageProps} />
        </ToastProvider>
      </AuthProvider>
    </div>
  );
}
