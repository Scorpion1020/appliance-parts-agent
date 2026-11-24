"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentResponse, CartSnapshot, ChatMessage, ConversationMemory, ConversationState, Product, SessionMetrics } from "@/lib/types";
import { MessageBubble } from "@/components/MessageBubble";
import { SuggestedPrompts } from "@/components/SuggestedPrompts";
import { CartPanel } from "@/components/CartPanel";
import { createConversationMemory, mergeConversationMemory } from "@/lib/agent/memory";
import { recentlyViewedFromHistory, restoreMessages } from "@/lib/conversation-view";
import { localizeErrorMessage, SUGGESTED_PROMPTS, UI_TEXT, type Locale } from "@/lib/i18n";

const LOCALE_STORAGE_KEY = "partselect_locale";

function createWelcomeMessage(locale: Locale): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: UI_TEXT[locale].welcomeMessage
  };
}

function createMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ChatBox() {
  const [locale, setLocale] = useState<Locale>("zh");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createWelcomeMessage("zh")]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [liveSteps, setLiveSteps] = useState<string[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>([]);
  const [memory, setMemory] = useState<ConversationMemory>(createConversationMemory());
  const [cart, setCart] = useState<CartSnapshot | null>(null);
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [cartError, setCartError] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<{ message: string; requestId: string } | null>(null);
  const busyRef = useRef(false);
  const [sessionReady, setSessionReady] = useState(false);
  const sessionLoad = useRef<Promise<ConversationState & { cart: CartSnapshot }> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const t = UI_TEXT[locale];
  const canSend = input.trim().length > 0 && !loading && sessionReady;
  const quickExamples = useMemo(() => SUGGESTED_PROMPTS[locale], [locale]);

  async function refreshMetrics() {
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (res.ok) setMetrics((await res.json()) as SessionMetrics);
    } catch {
      // 非关键指标获取失败不影响主聊天流程
    }
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === "en" || saved === "zh") {
        setLocale(saved);
      }
    } catch {
      // 忽略本地存储读取失败
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.title = UI_TEXT[locale].appTitle;
    setMessages((prev) =>
      prev.map((item) => (item.id === "welcome" ? { ...item, content: UI_TEXT[locale].welcomeMessage } : item))
    );
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // 忽略本地存储写入失败
    }
  }, [locale]);

  useEffect(() => {
    let active = true;
    busyRef.current = true;
    setLoading(true);
    // 开发模式重复执行 effect 时复用同一初始化请求，避免创建两个会话。
    sessionLoad.current ??= fetch("/api/conversation").then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body.message ?? "restore_failed"), { code: body.code });
      return body as ConversationState & { cart: CartSnapshot };
    });
    void sessionLoad.current
      .then((state) => {
        if (!active) return;
        setCart(state.cart);
        setMemory(state.memory);
        setMessages([createWelcomeMessage(locale), ...restoreMessages(state)]);
        setRecentlyViewed(recentlyViewedFromHistory(state));
        const last = state.turns.at(-1);
        setRetryRequest(last && last.status !== "completed" ? { message: last.message, requestId: last.request_id } : null);
        setCartError(null);
        setSessionReady(true);
        void refreshMetrics();
      })
      .catch((error: unknown) => {
        if (active) {
          setSessionReady(false);
          const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
          const raw = error instanceof Error ? error.message : t.restoreFailed;
          setCartError(raw === "restore_failed" ? t.restoreFailed : localizeErrorMessage(code, raw, locale));
        }
      })
      .finally(() => {
        if (active) {
          busyRef.current = false;
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // 仅在首次挂载时恢复服务端会话；切换语言时同步更新欢迎语，不重拉接口
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startNewConversation() {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    setSessionReady(false);
    setExportError(null);
    setCartError(null);
    try {
      const response = await fetch("/api/conversation", { method: "POST" });
      const body = await response.json();
      if (!response.ok) {
        throw Object.assign(new Error(body?.message ?? t.newChatFailed), { code: body?.code });
      }
      const state = body as ConversationState & { cart: CartSnapshot };
      sessionLoad.current = Promise.resolve(state);
      setCart(state.cart);
      setMemory(state.memory);
      setMessages([createWelcomeMessage(locale)]);
      setRecentlyViewed([]);
      setRetryRequest(null);
      setInput("");
      setSessionReady(true);
      void refreshMetrics();
    } catch (error: unknown) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
      const raw = error instanceof Error ? error.message : t.newChatFailed;
      setCartError(localizeErrorMessage(code, raw, locale));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
  }

  async function exportHandoff() {
    if (loading || exporting || !sessionReady) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/conversation/export", { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw Object.assign(new Error(body?.message ?? t.exportFailed), { code: body?.code });
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "support-handoff.txt";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
      const raw = error instanceof Error ? error.message : t.exportFailed;
      setExportError(localizeErrorMessage(code, raw, locale));
    } finally {
      setExporting(false);
    }
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }

  async function sendMessage(nextMessage: string, requestId = createMessageId()) {
    const trimmed = nextMessage.trim();
    if (!trimmed || busyRef.current || !sessionReady) return;
    busyRef.current = true;
    setRetryRequest(null);

    const userMessage: ChatMessage = {
      id: `${requestId}-user`,
      role: "user",
      content: trimmed
    };

    setMessages((prev) => [
      ...prev.filter((item) => ![`${requestId}-user`, `${requestId}-assistant`, `${requestId}-error`].includes(item.id)),
      userMessage
    ]);
    setInput("");
    setLoading(true);
    setLiveSteps([]);
    scrollToBottom();

    const controller = new AbortController();
    // 服务器模型循环最多 55 秒，预留会话保存和网络往返时间。
    const timeoutId = window.setTimeout(() => controller.abort(), 70_000);
    let failureResponse: AgentResponse | undefined;
    let errorCode: string | undefined;

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        signal: controller.signal,
        body: JSON.stringify({
          requestId,
          message: trimmed
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        failureResponse = errorBody?.response;
        errorCode = errorBody?.code;
        if (["cart_not_found", "session_required"].includes(errorBody?.code)) setSessionReady(false);
        throw new Error(errorBody?.message ?? t.requestFailed);
      }

      let data: AgentResponse | null = null;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            let eventName = "message";
            const dataLines: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            if (!dataLines.length) continue;
            const parsed = JSON.parse(dataLines.join("\n"));
            if (eventName === "progress" && typeof parsed?.label === "string") {
              setLiveSteps((prev) => (prev[prev.length - 1] === parsed.label ? prev : [...prev.slice(-4), parsed.label]));
              scrollToBottom();
            } else if (eventName === "result") {
              data = parsed as AgentResponse;
            } else if (eventName === "error") {
              failureResponse = parsed?.response;
              errorCode = parsed?.code;
              if (["cart_not_found", "session_required"].includes(parsed?.code)) setSessionReady(false);
              throw new Error(parsed?.message ?? t.requestFailed);
            }
          }
        }
      } else {
        data = (await response.json()) as AgentResponse;
      }
      if (!data) throw new Error(t.requestFailed);
      if (data.cart) {
        setCart(data.cart);
        setCartError(null);
      }
      setMemory((previous) => mergeConversationMemory(previous, data.memory));
      void refreshMetrics();

      setMessages((prev) => [
        ...prev,
        {
          id: `${requestId}-assistant`,
          role: "assistant",
          content: data.message,
          response: data
        }
      ]);

      if (data.products?.[0]) {
        const products = data.products;
        setRecentlyViewed((previous) => {
          const next = [...products, ...previous];
          const deduped: Product[] = [];
          const seen = new Set<string>();

          for (const item of next) {
            if (seen.has(item.partNumber)) continue;
            seen.add(item.partNumber);
            deduped.push(item);
          }

          return deduped.slice(0, 6);
        });
      }
    } catch (error) {
      setRetryRequest({ message: trimmed, requestId });
      setCart(null);
      setCartError(t.cartSyncWarning);
      const isTimeout = error instanceof DOMException && error.name === "AbortError";
      const rawMessage = error instanceof Error ? error.message : t.requestFailed;
      setMessages((prev) => [
        ...prev,
        {
          id: `${requestId}-error`,
          role: "assistant",
          response: failureResponse,
          content: isTimeout ? t.timeoutError : localizeErrorMessage(errorCode, rawMessage, locale)
        }
      ]);
    } finally {
      busyRef.current = false;
      window.clearTimeout(timeoutId);
      setLoading(false);
      scrollToBottom();
    }
  }

  function viewInstallationGuide(product: Product) {
    void sendMessage(t.promptInstall(product.partNumber));
  }

  function checkCompatibility(product: Product) {
    if (memory.currentModelNumber) {
      void sendMessage(t.promptCheckFitWithModel(product.partNumber, memory.currentModelNumber));
      return;
    }

    void sendMessage(t.promptCheckFitNoModel(product.partNumber));
  }

  function addToCart(product: Product) {
    void sendMessage(t.promptAddToCart(product.partNumber));
  }

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-[#1f2937]">
      <header className="sticky top-0 z-40 border-b border-[#d5d9e0] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <div className="flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight text-[#1f2937]">{t.appTitle}</h1>
            <span className="hidden text-xs text-[#6b7280] sm:inline">{t.appSubtitle}</span>
          </div>

          <div className="flex items-center gap-3 text-xs text-[#6b7280]">
            <div
              role="group"
              aria-label="Language"
              className="inline-flex rounded-lg border border-[#d5d9e0] bg-[#f4f6f9] p-0.5"
            >
              <button
                type="button"
                onClick={() => setLocale("zh")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  locale === "zh" ? "bg-[#3d5a73] text-white" : "text-[#4b5563] hover:text-[#1f2937]"
                }`}
              >
                中文
              </button>
              <button
                type="button"
                onClick={() => setLocale("en")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  locale === "en" ? "bg-[#3d5a73] text-white" : "text-[#4b5563] hover:text-[#1f2937]"
                }`}
              >
                EN
              </button>
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#dce9e3] px-3 py-1 text-xs font-medium text-[#2e5243]">
              <span className={`h-1.5 w-1.5 rounded-full ${loading ? "animate-pulse bg-[#9e4a4a]" : "bg-[#2e5243]"}`} />
              {loading ? t.statusSearching : t.statusReady}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.68fr)_370px]">
          <section className="flex min-h-[78vh] flex-col overflow-hidden rounded-2xl border border-[#d5d9e0] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e7eb] px-5 py-3.5">
              <div>
                <h2 className="text-sm font-semibold text-[#1f2937]">{t.chatTitle}</h2>
                <p className="mt-0.5 text-xs text-[#6b7280]">{t.chatSubtitle}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void startNewConversation()}
                  className="font-medium text-[#3d5a73] underline underline-offset-4 hover:text-[#1f2937] disabled:opacity-40"
                >
                  {t.newChat}
                </button>
                <span className="h-3 w-px bg-[#d5d9e0]" />
                <div className="group relative">
                  <button
                    type="button"
                    disabled={loading || exporting || !sessionReady}
                    aria-describedby="export-tooltip"
                    onClick={() => void exportHandoff()}
                    className="font-medium text-[#5e5070] underline underline-offset-4 hover:text-[#1f2937] disabled:opacity-40"
                  >
                    {exporting ? t.exportingChat : t.exportChat}
                  </button>
                  <div
                    id="export-tooltip"
                    role="tooltip"
                    className="pointer-events-none invisible absolute right-0 top-full z-50 mt-2 w-64 translate-y-1 rounded-lg bg-[#2f4356] px-3 py-2 text-xs leading-5 text-white opacity-0 shadow-md transition-all duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100"
                  >
                    <span className="absolute -top-1 right-4 h-2 w-2 rotate-45 bg-[#2f4356]" />
                    {t.exportTooltip}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto bg-[#f7f8fa] px-5 py-5">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onViewInstallationGuide={viewInstallationGuide}
                  onCheckCompatibility={checkCompatibility}
                  onAddToCart={addToCart}
                  busy={loading || !sessionReady}
                  showDebug={false}
                  locale={locale}
                  onConfirmCart={(proposalId, confirmationId) =>
                    void sendMessage(t.promptConfirmCart(proposalId), confirmationId)
                  }
                  onFeedbackSaved={() => void refreshMetrics()}
                />
              ))}
              {loading && (
                <div className="flex justify-start animate-[fadeIn_0.2s_ease-out]">
                  <div className="w-full max-w-[92%] rounded-2xl border border-[#d5d9e0] bg-white px-4 py-3.5 text-[#1f2937]">
                    <p className="mb-1.5 text-xs font-semibold text-[#3d5a73]">{t.assistantLabel}</p>
                    <div className="space-y-1.5 text-xs text-[#6b7280]">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-[#3d5a73]" />
                        <span>{liveSteps[liveSteps.length - 1] ?? t.thinkingText}</span>
                      </div>
                      {liveSteps.length > 1 && (
                        <ul className="space-y-0.5 pl-4 text-[11px] text-[#9ca3af]">
                          {liveSteps.slice(0, -1).map((step, idx) => (
                            <li key={`${idx}-${step}`}>✓ {step}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t border-[#e5e7eb] bg-white px-5 py-4">
              {exportError && (
                <p role="alert" className="mb-3 rounded-lg bg-[#f2e0e0] px-3 py-2 text-xs text-[#8a3f3f]">
                  {exportError}
                </p>
              )}
              {retryRequest && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void sendMessage(retryRequest.message, retryRequest.requestId)}
                  className="mb-3 text-xs font-medium text-[#9e4a4a] underline underline-offset-4 disabled:opacity-50"
                >
                  {t.retryFailed}
                </button>
              )}

              <div className="mb-3.5">
                <p className="mb-2 text-xs font-medium text-[#4b5563]">{t.suggestedHeading}</p>
                <SuggestedPrompts prompts={quickExamples} onPromptClick={sendMessage} />
              </div>

              <form
                className="flex items-center gap-2.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendMessage(input);
                }}
              >
                <label className="flex-1">
                  <span className="sr-only">{t.inputLabel}</span>
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                        event.preventDefault();
                        void sendMessage(input);
                      }
                    }}
                    placeholder={t.inputPlaceholder}
                    rows={1}
                    className="block h-[42px] w-full resize-none rounded-xl border border-[#cbd5e1] bg-white px-3.5 py-2.5 text-sm leading-5 text-[#1f2937] outline-none transition placeholder:text-[#9ca3af] focus:border-[#3d5a73]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!canSend}
                  className="inline-flex h-[42px] min-w-[80px] items-center justify-center rounded-xl bg-[#3d5a73] px-5 text-sm font-medium text-white transition hover:bg-[#31495e] disabled:cursor-not-allowed disabled:bg-[#dce0e5] disabled:text-[#6b7280]"
                >
                  {t.send}
                </button>
              </form>
            </div>
          </section>

          <div className="lg:sticky lg:top-20 lg:self-start">
            <CartPanel
              cart={cart}
              metrics={metrics}
              error={cartError}
              busy={loading || !sessionReady}
              recentlyViewed={recentlyViewed}
              onQuickHelp={sendMessage}
              locale={locale}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
