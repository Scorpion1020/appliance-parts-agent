import type { CartSnapshot, Product, SessionMetrics } from "@/lib/types";
import { localizeText, QUICK_ACTIONS, UI_TEXT, type Locale } from "@/lib/i18n";

type CartPanelProps = {
  cart: CartSnapshot | null;
  metrics?: SessionMetrics | null;
  error: string | null;
  busy: boolean;
  recentlyViewed: Product[];
  onQuickHelp: (message: string) => void;
  locale?: Locale;
};

export function CartPanel({
  cart,
  metrics,
  error,
  busy,
  recentlyViewed,
  onQuickHelp,
  locale = "zh"
}: CartPanelProps) {
  const t = UI_TEXT[locale];
  const quickActions = QUICK_ACTIONS[locale];

  return (
    <aside className="rounded-2xl border border-[#d5d9e0] bg-white">
      <div className="flex items-center justify-between border-b border-[#e5e7eb] px-5 py-3.5">
        <h2 className="text-sm font-semibold text-[#1f2937]">{t.cartPanelTitle}</h2>
        <span className="rounded-md bg-[#dce9e3] px-2.5 py-0.5 text-xs font-medium text-[#2e5243]">
          {error ? t.cartStatusPending : busy ? t.cartStatusBusy : cart ? t.cartStatusSynced : t.cartStatusIdle}
        </span>
      </div>

      <div className="divide-y divide-[#e5e7eb]">
        <section className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-[#3d5a73]">
              {t.cartPrefix} ·{" "}
              {error ? t.cartHeadingPending : busy ? t.cartHeadingBusy : cart ? t.cartHeadingSynced : t.cartHeadingIdle}
            </h3>
            <button
              type="button"
              disabled={busy}
              onClick={() => onQuickHelp(t.promptViewCart)}
              className="text-xs font-medium text-[#3d5a73] underline underline-offset-4 hover:text-[#1f2937] disabled:opacity-50"
            >
              {t.refreshCart}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-[#6b7280]">{t.cartPriceNotice}</p>
          {error && (
            <p role="alert" className="mt-2 rounded-lg bg-[#f2e0e0] px-3 py-2 text-xs text-[#8a3f3f]">
              {error}
            </p>
          )}
          {cart && (
            <div className="mt-3 space-y-2.5">
              {cart.items.length === 0 && (
                <p className="rounded-xl bg-[#f1f4f7] px-3.5 py-3 text-xs text-[#4b5563]">{t.cartEmpty}</p>
              )}
              {cart.items.map((item) => (
                <div key={item.product_id} className="rounded-xl border border-[#d5d9e0] bg-[#f8fafc] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-[#1f2937]">{localizeText(item.name, locale)}</p>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onQuickHelp(t.promptRemoveFromCart(item.product_id))}
                      className="shrink-0 text-xs font-medium text-[#9e4a4a] underline underline-offset-2 hover:text-[#7d3636] disabled:opacity-50"
                    >
                      {t.removeItem}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-[#6b7280]">
                    {item.product_id} · {t.quantityLabel} {item.quantity} · {item.currency}{" "}
                    {item.line_total ?? t.itemPriceUnknown}
                  </p>
                  {!item.available && <p className="mt-1.5 text-xs text-[#9e4a4a]">{t.itemUnavailableNote}</p>}
                </div>
              ))}
              <div className="flex items-center justify-between pt-1 text-xs font-semibold text-[#1f2937]">
                <span>{t.itemCountText(cart.item_count)}</span>
                <span>{t.subtotalText(cart.currency ?? "", cart.subtotal)}</span>
              </div>
            </div>
          )}
        </section>

        <section className="p-5">
          <h3 className="text-xs font-semibold text-[#5e5070]">{t.recentlyViewedTitle}</h3>
          <div className="mt-3 space-y-2">
            {recentlyViewed.length === 0 ? (
              <div className="rounded-xl bg-[#efecf3] p-3.5 text-xs text-[#5e5070]">
                <p className="font-medium text-[#3b3048]">{t.recentlyViewedEmptyTitle}</p>
                <p className="mt-0.5">{t.recentlyViewedEmptyDesc}</p>
              </div>
            ) : (
              recentlyViewed.map((item) => (
                <div key={item.partNumber} className="rounded-xl border border-[#d5d9e0] bg-[#f8fafc] p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-[#1f2937]">{localizeText(item.name, locale)}</p>
                    <span className="text-xs text-[#6b7280]">{item.partNumber}</span>
                  </div>
                  <button
                    type="button"
                    disabled={busy || item.purchasable !== true}
                    onClick={() => onQuickHelp(t.promptAddToCart(item.partNumber))}
                    className="mt-2 text-xs font-medium text-[#3d5a73] underline underline-offset-4 hover:text-[#1f2937] disabled:opacity-40"
                  >
                    {t.proposeAddCart}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="p-5">
          <h3 className="text-xs font-semibold text-[#2e5243]">{t.quickHelpTitle}</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={busy}
                onClick={() => onQuickHelp(action.prompt)}
                className="rounded-xl border border-[#d5d9e0] bg-[#f4f6f9] px-3 py-2.5 text-center text-xs font-medium text-[#1f2937] transition hover:border-[#3d5a73] hover:bg-[#dce6ee] disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
        </section>

        {metrics && (
          <section className="p-5">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-[#3d5a73]">
                <span>{locale === "zh" ? "会话运行指标" : "Session Metrics"}</span>
                <span className="text-[11px] font-normal text-[#6b7280] group-open:hidden">
                  {locale === "zh" ? "展开" : "Show"}
                </span>
                <span className="hidden text-[11px] font-normal text-[#6b7280] group-open:inline">
                  {locale === "zh" ? "收起" : "Hide"}
                </span>
              </summary>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-[#f4f6f9] px-2.5 py-2">
                  <dt className="text-[11px] text-[#6b7280]">{locale === "zh" ? "咨询轮次" : "Turns"}</dt>
                  <dd className="mt-0.5 font-semibold text-[#1f2937]">
                    {metrics.completedTurns}/{metrics.totalTurns}
                  </dd>
                </div>
                <div className="rounded-lg bg-[#f4f6f9] px-2.5 py-2">
                  <dt className="text-[11px] text-[#6b7280]">{locale === "zh" ? "加购确认" : "Confirmed"}</dt>
                  <dd className="mt-0.5 font-semibold text-[#1f2937]">
                    {metrics.confirmedAdditions}/{metrics.cartProposals}
                  </dd>
                </div>
                <div className="col-span-2 flex items-center justify-between rounded-lg bg-[#f4f6f9] px-2.5 py-2">
                  <span className="text-[11px] text-[#6b7280]">{locale === "zh" ? "服务反馈" : "Feedback"}</span>
                  <span className="font-semibold text-[#1f2937]">
                    👍 {metrics.feedback.up} · 👎 {metrics.feedback.down}
                  </span>
                </div>
              </dl>
            </details>
          </section>
        )}
      </div>
    </aside>
  );
}
