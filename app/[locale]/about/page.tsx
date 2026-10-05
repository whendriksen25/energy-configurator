import Link from "next/link";
import { DICTS, isLocale } from "@/lib/i18n";
import { SOURCES, MODEL_VERSION } from "@/lib/engine/params";

export default function About({ params }: { params: { locale: string } }) {
  const locale = isLocale(params.locale) ? params.locale : "nl";
  const t = DICTS[locale];
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">{t.about.title}</h1>
      <div className="mt-4 space-y-3 text-ink2">
        {t.about.method.map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
      </div>
      <h2 className="mt-8 text-lg font-semibold">{t.about.assumptions}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-ink2">
        {t.about.assumptionList.map((a) => <li key={a}>{a}</li>)}
      </ul>
      <h2 className="mt-8 text-lg font-semibold">{t.about.sources}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-ink2">
        {SOURCES.map((s) => <li key={s.key}>{s.text}</li>)}
      </ul>
      <p className="mt-8 text-sm text-muted">{t.disclaimer}</p>
      <p className="mt-2 text-sm text-muted">{t.about.version}: {MODEL_VERSION}</p>
      <Link href={`/${locale}`} className="btn btn-ghost mt-6">{t.about.back}</Link>
    </main>
  );
}
