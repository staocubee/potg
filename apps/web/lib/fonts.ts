import { Inter, Fraunces } from "next/font/google";

// Shared between _document.tsx (applies the .variable classes to <html>,
// so styles/globals.css's --potg-font/--potg-font-display can resolve
// var(--font-inter)/var(--font-fraunces) at the body level and below —
// a CSS custom property is only visible to the element that defines it
// and its descendants, so this has to live above <body>, not inside a
// wrapper div under it) and _app.tsx (imports the same instances so
// next/font only injects one set of @font-face rules).
export const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });
export const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
});
