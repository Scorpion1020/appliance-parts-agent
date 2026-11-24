import type { KnowledgeSearch } from "@/lib/knowledge/types";
import { isKnowledgeSourceUrl } from "@/lib/knowledge/source";
import { localizeStatus, localizeText, UI_TEXT, type Locale } from "@/lib/i18n";

export function KnowledgeEvidence({
  searches,
  locale = "zh",
  showDebug = true
}: {
  searches: KnowledgeSearch[];
  locale?: Locale;
  showDebug?: boolean;
}) {
  const t = UI_TEXT[locale];
  return (
    <div className="space-y-3">
      {searches.map((search, searchIndex) => (
        <section key={searchIndex} className="rounded-xl border border-[#d5d9e0] bg-[#f4f6f9] p-3.5 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#dce0e5] pb-2">
            <h3 className="text-xs font-semibold text-[#1f2937]">
              {t.knowledgeTitle} · {localizeStatus(search.status, locale)}
            </h3>
            {showDebug && (
              <p className="text-xs text-[#6b7280]">
                {search.method === "hybrid" ? "向量与关键词混合检索" : "关键词检索"} · 版本 {search.indexVersion.slice(0, 8)}
              </p>
            )}
          </div>
          {showDebug && search.embeddingModel && (
            <p className="mt-1.5 text-xs text-[#6b7280]">向量模型：{search.embeddingModel}</p>
          )}
          {search.hits.length === 0 && <p className="mt-2 text-xs text-[#6b7280]">{t.knowledgeEmpty}</p>}
          {search.hits.map((hit) => (
            <article key={hit.chunkId} className="mt-3 border-t border-[#dce0e5] pt-3 first:mt-2 first:border-t-0 first:pt-0">
              <h4 className="font-semibold text-[#1f2937]">
                {localizeText(hit.title, locale)} — {localizeText(hit.heading, locale)}
              </h4>
              <p className="mt-1 text-xs text-[#6b7280]">{t.knowledgeReviewedAt(hit.reviewedAt)}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#374151]">{localizeText(hit.summary, locale)}</p>
              <p className="mt-2 text-xs text-[#6b7280]">
                {t.knowledgeScope}
                {localizeText(hit.scope, locale)}
              </p>
              <p className="mt-1.5 rounded-lg bg-[#f2e0e0] px-3 py-1.5 text-xs text-[#8a3f3f]">
                {t.knowledgeSafety}
                {localizeText(hit.safety, locale)}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-4 text-xs text-[#6b7280]">
                {isKnowledgeSourceUrl(hit.sourceUrl) && (
                  <a className="font-medium text-[#3d5a73] underline underline-offset-4 hover:text-[#1f2937]" href={hit.sourceUrl} target="_blank" rel="noreferrer">
                    {t.knowledgeSourceLink}
                  </a>
                )}
                {showDebug && (
                  <>
                    <details className="inline-block">
                      <summary className="cursor-pointer hover:text-[#1f2937]">核对原始英文摘要</summary>
                      <div className="mt-2 space-y-1 rounded-lg border border-[#d5d9e0] bg-white p-2.5 text-xs text-[#4b5563]">
                        <p>{hit.summary}</p>
                        <p>{hit.scope}</p>
                        <p>{hit.safety}</p>
                      </div>
                    </details>
                    <details className="inline-block">
                      <summary className="cursor-pointer hover:text-[#1f2937]">查看检索溯源</summary>
                      <div className="mt-2 space-y-0.5 rounded-lg border border-[#d5d9e0] bg-white p-2.5 text-xs text-[#6b7280]">
                        <p className="break-all">片段编号：{hit.chunkId}</p>
                        <p className="break-all">文档版本：{hit.documentVersion}</p>
                        <p>排序得分：{hit.score}（不代表可信度）</p>
                      </div>
                    </details>
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
