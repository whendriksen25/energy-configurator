import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import "../globals.css";
import { DICTS, LOCALES, isLocale } from "@/lib/i18n";
import Header from "@/components/Header";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  const t = DICTS[isLocale(params.locale) ? params.locale : "nl"];
  return {
    title: t.meta.title,
    description: t.meta.description,
    robots: { index: false, follow: false }, // phase 4a: not public yet
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Applies the saved theme before first paint (no flash).
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function LocaleLayout({ children, params }: { children: React.ReactNode; params: { locale: string } }) {
  if (!isLocale(params.locale)) notFound();
  const t = DICTS[params.locale];
  return (
    <html lang={params.locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans">
        <Header locale={params.locale} t={t} />
        {children}
      </body>
    </html>
  );
}
