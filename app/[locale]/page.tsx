import { DICTS, isLocale } from "@/lib/i18n";
import Configurator from "@/components/Configurator";

export default function Page({ params }: { params: { locale: string } }) {
  const locale = isLocale(params.locale) ? params.locale : "nl";
  return (
    <main>
      <Configurator locale={locale} t={DICTS[locale]} />
    </main>
  );
}
