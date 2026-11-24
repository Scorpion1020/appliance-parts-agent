"use client";

import { useState } from "react";
import type { ChatMessage, Product } from "@/lib/types";
import { ProductCard } from "@/components/ProductCard";
import { isPartSelectUrl } from "@/lib/web/sourceUrl";
import { KnowledgeEvidence } from "@/components/KnowledgeEvidence";
import { localizeStatus, localizeText, UI_TEXT, type Locale } from "@/lib/i18n";

type MessageBubbleProps = {
  message: ChatMessage;
  onViewInstallationGuide: (product: Product) => void;
  onCheckCompatibility: (product: Product) => void;
  onAddToCart?: (product: Product) => void;
  onConfirmCart?: (proposalId: string, confirmationId: string) => void;
  onFeedbackSaved?: () => void;
  busy?: boolean;
  showDebug?: boolean;
  locale?: Locale;
};

function safeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function MessageBubble({
  message,
  onViewInstallationGuide,
  onCheckCompatibility,
  onAddToCart,
  onConfirmCart,
  onFeedbackSaved,
  busy,
  showDebug = true,
  locale = "zh"
}: MessageBubbleProps) {
  const t = UI_TEXT[locale];
  const isUser = message.role === "user";
  const response = message.response;
  const compatibilities = response?.compatibilities ?? (response?.compatibility ? [response.compatibility] : []);

  if (isUser) {
    return (
      <div className="flex justify-end animate-[fadeIn_0.2s_ease-out]">
        <div className="max-w-[85%] rounded-2xl bg-[#dce6ee] px-4 py-3 text-[#1f2937]">
          <p className="mb-1 text-xs font-semibold text-[#3d5a73]">{t.userLabel}</p>
          <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        </div>
      </div>
    );
  }

  const isTroubleshooting = response?.intent === "troubleshooting";
  const visibleSections =
    response?.sections
      ?.map((section) => ({
        ...section,
        title: safeText(section.title),
        items: section.items.map(safeText).filter(Boolean)
      }))
      .filter((section) => section.title && section.items.length > 0) ?? [];

  return (
    <div className="flex justify-start animate-[fadeIn_0.2s_ease-out]">
      <div className="w-full max-w-[92%] rounded-2xl border border-[#d5d9e0] bg-white px-4 py-3.5 text-[#1f2937]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold text-[#3d5a73]">{t.assistantLabel}</span>
          {response?.groundingStatus && <GroundingBadge status={response.groundingStatus} locale={locale} />}
        </div>

        {response?.groundedSummary && (
          <div className="mb-2.5 rounded-xl border border-[#dbe5ee] bg-[#f4f8fb] px-3.5 py-2.5 text-sm leading-6 text-[#1f2937]">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#3d5a73]">
              {locale === "zh" ? "综合摘要（基于已核验工具数据）" : "Grounded Summary"}
            </p>
            <p className="whitespace-pre-wrap">{response.groundedSummary}</p>
          </div>
        )}

        <p className="whitespace-pre-wrap text-sm leading-6 text-[#374151]">{localizeText(message.content, locale)}</p>

        {response?.cartProposal?.requestId && response.cartProposal.confirmationId && onConfirmCart && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f2e0e0] px-3.5 py-2.5">
            <span className="text-xs font-medium text-[#7d3636]">
              {t.pendingCartPrefix} {t.pendingCartSummary(response.cartProposal.quantity, response.cartProposal.partNumber)}
            </span>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-[#9e4a4a] px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-[#853c3c] disabled:opacity-50"
              onClick={() => onConfirmCart(response.cartProposal!.requestId!, response.cartProposal!.confirmationId!)}
            >
              {t.confirmAddCart(response.cartProposal.quantity, response.cartProposal.partNumber)}
            </button>
          </div>
        )}

        {response && (
          <div className="mt-3.5 space-y-3.5">
            {showDebug && (
              <>
                <p className="text-xs text-[#6b7280]">
                  调用工具：{response.tool} · {response.responseTimeMs ?? 0} 毫秒 · 模型用量：{response.tokens?.total ?? 0}
                </p>

                {response.trace && (
                  <details className="text-xs text-[#6b7280]">
                    <summary className="cursor-pointer font-medium hover:text-[#1f2937]">
                      查看执行过程（{response.trace.length} 步）
                    </summary>
                    <ol className="mt-2 space-y-1.5 rounded-xl border border-[#d5d9e0] bg-[#f4f6f9] p-3 text-xs">
                      {response.trace.map((step) => (
                        <li key={step.id} className="border-b border-[#e2e5ea] pb-1.5 last:border-b-0 last:pb-0">
                          {step.tool} · {localizeStatus(step.status, locale)} · {step.elapsedMs} 毫秒
                          {step.model && <span> · {step.model}</span>}
                          {!!step.quotaSkippedModels?.length && <p>免费额度不可用：{step.quotaSkippedModels.join(", ")}</p>}
                          {step.arguments && <pre className="mt-1 whitespace-pre-wrap text-[#374151]">{JSON.stringify(step.arguments)}</pre>}
                          {step.error && <p className="mt-1 text-[#9e4a4a]">{localizeText(step.error, locale)}</p>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </>
            )}

            {response.knowledge && <KnowledgeEvidence searches={response.knowledge} locale={locale} showDebug={showDebug} />}

            {compatibilities.map((fit, fitIndex) => (
              <section key={`${fit.partNumber}-${fit.modelNumber}-${fitIndex}`} className="rounded-xl border border-[#d5d9e0] bg-[#f4f6f9] p-3.5 text-sm">
                <div className="flex items-center justify-between gap-2 border-b border-[#dce0e5] pb-2">
                  <h3 className="text-xs font-semibold text-[#1f2937]">
                    {t.compatibilityTitle} · {localizeStatus(fit.status, locale)}
                  </h3>
                  <span className="text-xs text-[#6b7280]">
                    {fit.partNumber} / {fit.modelNumber}
                  </span>
                </div>
                {fit.evidence.length === 0 ? (
                  <p className="mt-2 text-xs text-[#9e4a4a]">{t.compatibilityEmpty}</p>
                ) : (
                  <ul className="mt-2.5 space-y-2.5">
                    {fit.evidence.map((item, index) => (
                      <li key={index} className="text-xs">
                        <p className="font-medium text-[#374151]">
                          {item.source.origin === "live"
                            ? t.originLive
                            : item.source.origin === "reviewed"
                              ? t.originReviewed
                              : t.originDemo}{" "}
                          · {localizeStatus(item.verdict, locale)}
                        </p>
                        {locale === "zh" ? (
                          <details className="mt-1 text-xs text-[#6b7280]">
                            <summary className="cursor-pointer hover:text-[#1f2937]">{t.viewSourceSnippet}</summary>
                            <blockquote className="mt-1.5 rounded-lg border border-[#d5d9e0] bg-white p-2.5 text-xs leading-5 text-[#374151]">
                              {item.excerpt}
                            </blockquote>
                          </details>
                        ) : (
                          <blockquote className="mt-1.5 rounded-lg border border-[#d5d9e0] bg-white p-2.5 text-xs leading-5 text-[#374151]">
                            {item.excerpt}
                          </blockquote>
                        )}
                        {isPartSelectUrl(item.source.url) && (
                          <a
                            href={item.source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1.5 inline-block font-medium text-[#3d5a73] underline underline-offset-4 hover:text-[#1f2937]"
                          >
                            {item.source.title}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}

            {response.sources && response.sources.length > 0 && (
              <section className="rounded-xl border border-[#d5d9e0] bg-[#f4f6f9] p-3.5 text-sm">
                <h3 className="border-b border-[#dce0e5] pb-2 text-xs font-semibold text-[#1f2937]">
                  {t.sourcesTitle}
                </h3>
                <ul className="mt-2.5 space-y-2">
                  {response.sources
                    .filter((source) => isPartSelectUrl(source.url))
                    .map((source, index) => (
                      <li key={`${source.url}-${index}`}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-[#3d5a73] underline underline-offset-4 hover:text-[#1f2937]"
                        >
                          {source.title}
                        </a>
                        <p className="mt-0.5 text-xs text-[#6b7280]">
                          {source.origin === "live"
                            ? t.sourceOriginLive
                            : source.origin === "reviewed"
                              ? t.sourceOriginReviewed
                              : t.sourceOriginDemo}
                          {source.retrievedAt ? ` · ${source.retrievedAt}` : ""}
                        </p>
                      </li>
                    ))}
                </ul>
              </section>
            )}

            {visibleSections.length > 0 && (
              <div className="rounded-xl border border-[#d5d9e0] bg-[#f4f6f9] p-3.5 text-sm">
                <div className="flex items-center justify-between gap-3 border-b border-[#dce0e5] pb-2">
                  <p className="text-xs font-semibold text-[#1f2937]">
                    {isTroubleshooting ? t.troubleshootingTitle : t.queryResultTitle}
                  </p>
                  <span className="rounded-md bg-[#e5e0ec] px-2 py-0.5 text-xs font-medium text-[#5e5070]">
                    {t.guidanceBadge}
                  </span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {visibleSections.map((section) => (
                    <div key={section.title} className="rounded-lg border border-[#d5d9e0] bg-white p-3">
                      <p className="text-xs font-semibold text-[#3d5a73]">{localizeText(section.title, locale)}</p>
                      <ul className="mt-2 space-y-1.5">
                        {section.items.map((item) => (
                          <li key={item} className="flex gap-2.5 text-sm text-[#374151]">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#5e5070]" />
                            <span className="leading-6">{localizeText(item, locale)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!isTroubleshooting && response.steps && response.steps.length > 0 && (
              <div className="rounded-xl border border-[#d5d9e0] bg-[#f4f6f9] p-3.5 text-sm">
                <p className="border-b border-[#dce0e5] pb-2 text-xs font-semibold text-[#1f2937]">
                  {t.installGuideTitle}
                </p>
                <ol className="mt-3 space-y-2">
                  {response.steps.map((step, index) => (
                    <li key={`${step}-${index}`} className="flex gap-3 text-sm text-[#374151]">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#dce6ee] text-xs font-semibold text-[#3d5a73]">
                        {index + 1}
                      </span>
                      <span className="leading-6">{localizeText(step, locale)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {response.products && response.products.length > 0 && (
              <div className="grid gap-3">
                {response.products.map((product) => (
                  <ProductCard
                    key={product.partNumber}
                    product={product}
                    onViewInstallationGuide={onViewInstallationGuide}
                    onCheckCompatibility={onCheckCompatibility}
                    onAddToCart={onAddToCart}
                    responseIntent={response.intent}
                    locale={locale}
                    compatibilityStatus={compatibilities.find((fit) => fit.partNumber === product.partNumber)?.status}
                  />
                ))}
              </div>
            )}
            <FeedbackBar
              requestId={message.id.replace(/-assistant$/, "")}
              initialFeedback={message.feedback ?? null}
              onSaved={onFeedbackSaved}
              locale={locale}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const FEEDBACK_REASONS = [
  { id: "not_found", zh: "未找到配件", en: "Part not found" },
  { id: "compatibility_unclear", zh: "适配不清", en: "Fit unclear" },
  { id: "slow_response", zh: "响应太慢", en: "Too slow" },
  { id: "inaccurate", zh: "内容不准", en: "Inaccurate" }
] as const;

function FeedbackBar({
  requestId,
  initialFeedback,
  onSaved,
  locale
}: {
  requestId: string;
  initialFeedback?: { rating: "up" | "down"; reason?: string | null } | null;
  onSaved?: () => void;
  locale: Locale;
}) {
  const [rating, setRating] = useState<"up" | "down" | null>(initialFeedback?.rating ?? null);
  const [selectedReason, setSelectedReason] = useState<string | null>(initialFeedback?.reason ?? null);
  const [saved, setSaved] = useState(Boolean(initialFeedback));

  if (!requestId || requestId === "welcome" || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)) {
    return null;
  }

  async function submit(nextRating: "up" | "down", reason?: string) {
    setRating(nextRating);
    if (reason) setSelectedReason(reason);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, rating: nextRating, ...(reason ? { reason } : {}) })
      });
      if (res.ok) {
        setSaved(true);
        onSaved?.();
      }
    } catch {
      // 静默忽略非关键反馈上报错误
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[#eef0f3] pt-2 text-[11px] text-[#6b7280]">
      <span>{locale === "zh" ? "本次回答有帮助吗？" : "Was this helpful?"}</span>
      <button
        type="button"
        onClick={() => void submit("up")}
        className={`rounded-md border px-2 py-0.5 transition ${rating === "up" ? "border-[#2e5243] bg-[#dce9e3] text-[#2e5243]" : "border-[#d5d9e0] hover:bg-[#f3f4f6]"}`}
      >
        {locale === "zh" ? "有帮助" : "Helpful"}
      </button>
      <button
        type="button"
        onClick={() => void submit("down")}
        className={`rounded-md border px-2 py-0.5 transition ${rating === "down" ? "border-[#9e4a4a] bg-[#f2e0e0] text-[#7d3636]" : "border-[#d5d9e0] hover:bg-[#f3f4f6]"}`}
      >
        {locale === "zh" ? "需改进" : "Needs work"}
      </button>
      {rating === "down" && (
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_REASONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void submit("down", item.id)}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition ${selectedReason === item.id ? "border-[#9e4a4a] bg-[#9e4a4a] text-white" : "border-[#d5d9e0] hover:bg-[#f3f4f6]"}`}
            >
              {locale === "zh" ? item.zh : item.en}
            </button>
          ))}
        </div>
      )}
      {saved && <span className="text-[#2e5243]">{locale === "zh" ? "已记录反馈" : "Recorded"}</span>}
    </div>
  );
}

function GroundingBadge({
  status,
  locale
}: {
  status: NonNullable<ChatMessage["response"]>["groundingStatus"];
  locale: Locale;
}) {
  const t = UI_TEXT[locale];
  const label =
    status === "verified_live"
      ? t.groundingLive
      : status === "demo_fallback"
        ? t.groundingDemo
        : status === "searching"
          ? t.groundingSearching
          : t.groundingUnverified;

  const classes =
    status === "verified_live"
      ? "bg-[#dce9e3] text-[#2e5243]"
      : "bg-[#e5e0ec] text-[#5e5070]";

  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${classes}`}>{label}</span>;
}
