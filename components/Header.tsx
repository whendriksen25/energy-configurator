"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Dict, Locale } from "@/lib/i18n";

export default function Header({ locale, t }: { locale: Locale; t: Dict }) {
  const path = usePathname() || `/${locale}`;
  const other: Locale = locale === "nl" ? "en" : "nl";
  const otherPath = path.replace(/^\/(nl|en)/, `/${other}`);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const d = document.documentElement.dataset.theme;
    setDark(d ? d === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);

  function toggleTheme() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* storage unavailable */ }
    setDark(!dark);
  }

  function rememberLang() {
    document.cookie = `lang=${other}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link href={`/${locale}`} className="flex min-w-0 items-center gap-2 font-semibold text-ink">
          <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden="true">
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <circle cx="16" cy="13" r="5" fill="#eda100" />
            <path d="M8 24h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
            <path d="M11 20h10" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="truncate">{t.brand}</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1 text-sm sm:gap-2">
          <Link href={`/${locale}/about`} className="hidden rounded-lg px-2 py-1.5 text-ink2 hover:text-ink sm:inline">
            {t.nav.about}
          </Link>
          <Link href={otherPath} onClick={rememberLang} className="rounded-lg border border-line px-2 py-1.5 font-medium uppercase text-ink2 hover:text-ink"
            aria-label={`${t.nav.language}: ${other.toUpperCase()}`}>
            {other}
          </Link>
          <button type="button" onClick={toggleTheme} className="rounded-lg border border-line px-2 py-1.5 text-ink2 hover:text-ink"
            aria-label={`${t.nav.theme}: ${dark ? t.nav.light : t.nav.dark}`}>
            {dark ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
              </svg>
            )}
          </button>
        </nav>
      </div>
    </header>
  );
}
