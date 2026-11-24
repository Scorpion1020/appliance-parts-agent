import type { AgentIntent, CompatibilityResult, Product } from "@/lib/types";
import { localizeStatus, localizeText, UI_TEXT, type Locale } from "@/lib/i18n";

type ProductCardProps = {
  product: Product;
  onViewInstallationGuide?: (product: Product) => void;
  onCheckCompatibility?: (product: Product) => void;
  onAddToCart?: (product: Product) => void;
  compatibilityStatus?: CompatibilityResult["status"];
  responseIntent?: AgentIntent;
  locale?: Locale;
};

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(value);
}

export function ProductCard({
  product,
  onViewInstallationGuide,
  onCheckCompatibility,
  onAddToCart,
  compatibilityStatus,
  responseIntent,
  locale = "zh"
}: ProductCardProps) {
  const t = UI_TEXT[locale];
  const showInstallationAction = responseIntent !== "installation_guide";
  const showCompatibilityAction = responseIntent !== "compatibility_check";
  const canProposeCart = Boolean(onAddToCart) && product.purchasable !== false;
  const applianceLabel =
    product.applianceType === "refrigerator"
      ? t.refrigerator
      : product.applianceType === "dishwasher"
        ? t.dishwasher
        : product.applianceType;

  const availabilityClass =
    product.availability === "In stock"
      ? "bg-[#dce9e3] text-[#2e5243]"
      : product.availability === "Limited stock"
        ? "bg-[#f4e4d7] text-[#85522a]"
        : "bg-[#eaedf0] text-[#4b5563]";

  return (
    <article className="rounded-xl border border-[#d5d9e0] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-[#6b7280]">
            {localizeStatus(product.brand, locale)} · {applianceLabel} · {t.partNumberLabel} {product.partNumber}
          </p>
          <h3 className="mt-1 text-base font-semibold text-[#1f2937]">{localizeText(product.name, locale)}</h3>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-md px-2.5 py-1 text-xs font-medium ${availabilityClass}`}>
            {localizeStatus(product.availability, locale)}
          </span>
          {compatibilityStatus !== undefined && (
            <span
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                compatibilityStatus === "compatible"
                  ? "bg-[#dce9e3] text-[#2e5243]"
                  : compatibilityStatus === "incompatible"
                    ? "bg-[#f2e0e0] text-[#8a3f3f]"
                    : "bg-[#f4e4d7] text-[#85522a]"
              }`}
            >
              {compatibilityStatus === "compatible"
                ? t.compatible
                : compatibilityStatus === "incompatible"
                  ? t.incompatible
                  : t.compatibilityUnknown}
            </span>
          )}
        </div>
      </div>

      <p className="mt-2.5 text-sm leading-6 text-[#374151]">{localizeText(product.description, locale)}</p>
      {product.catalogOrigin && (
        <p className="mt-2 rounded-lg bg-[#f3f5f8] px-3 py-1.5 text-xs text-[#4b5563]">
          {t.catalogOriginNotice(localizeStatus(product.catalogOrigin, locale))}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2.5 text-sm">
        <div className="rounded-lg bg-[#f1f4f7] px-3 py-2.5">
          <dt className="text-xs text-[#6b7280]">{t.partNumberField}</dt>
          <dd className="mt-0.5 font-medium text-[#1f2937]">{product.partNumber}</dd>
        </div>
        <div className="rounded-lg bg-[#f1f4f7] px-3 py-2.5">
          <dt className="text-xs text-[#6b7280]">{t.priceField}</dt>
          <dd className="mt-0.5 font-semibold text-[#1f2937]">
            {product.price === null ? t.priceUnknown : currency(product.price)}
          </dd>
        </div>
      </dl>

      {product.symptoms.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-[#6b7280]">{t.symptomsLabel}</span>
          {product.symptoms.map((symptom) => (
            <span
              key={symptom}
              className="rounded-md bg-[#e5e0ec] px-2 py-0.5 text-xs text-[#4c405c]"
            >
              {localizeText(symptom, locale)}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {onAddToCart && (
          <button
            type="button"
            disabled={!canProposeCart}
            onClick={() => onAddToCart(product)}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-[#9e4a4a] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#853c3c] disabled:cursor-not-allowed disabled:bg-[#dce0e5] disabled:text-[#6b7280]"
          >
            {canProposeCart ? t.addToCart : t.unavailable}
          </button>
        )}
        <a
          href={product.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex flex-1 items-center justify-center rounded-lg bg-[#3d5a73] px-3 py-2 text-xs font-medium text-white transition hover:bg-[#31495e]"
        >
          {t.viewProductSource}
        </a>
        {showInstallationAction && (
          <button
            type="button"
            onClick={() => onViewInstallationGuide?.(product)}
            className="inline-flex flex-1 items-center justify-center rounded-lg border border-[#d1d5db] bg-white px-3 py-2 text-xs font-medium text-[#374151] transition hover:border-[#3d5a73] hover:bg-[#dce6ee]"
          >
            {t.installGuideBtn}
          </button>
        )}
        {showCompatibilityAction && (
          <button
            type="button"
            onClick={() => onCheckCompatibility?.(product)}
            className="inline-flex flex-1 items-center justify-center rounded-lg border border-[#d1d5db] bg-white px-3 py-2 text-xs font-medium text-[#374151] transition hover:border-[#3d5a73] hover:bg-[#dce6ee]"
          >
            {t.checkFitBtn}
          </button>
        )}
      </div>
    </article>
  );
}
