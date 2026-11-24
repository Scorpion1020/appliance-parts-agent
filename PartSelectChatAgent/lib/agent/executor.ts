import type { AgentResponse, ChatRequest, ConversationMemory, Product } from "@/lib/types";
import { trackAgentEvent } from "@/lib/analytics";
import {
  buildCompatibilityMessage,
  buildInstallationMessage,
  buildLookupMessage,
  buildTroubleshootingMessage,
  CLARIFICATION_MESSAGE,
  EMPTY_INPUT_MESSAGE,
  INCOMPLETE_PART_NUMBER_MESSAGE,
  INSTALLATION_PART_NEEDED_MESSAGE,
  OUT_OF_SCOPE_MESSAGE,
  PART_NOT_FOUND_MESSAGE,
  UNKNOWN_PRODUCT_MESSAGE,
  formatProductSummary
} from "@/lib/agent/prompts";
import { routeQuery, extractModelNumber } from "@/lib/agent/router";
import { runReadTool } from "@/lib/agent/model-tools";
import { parseCartCommand, updateCart } from "@/lib/agent/tools/cart";
import { checkCompatibility } from "@/lib/agent/tools/compatibility";
import { getInstallationGuide } from "@/lib/agent/tools/installation";
import { lookupPart, searchProducts } from "@/lib/agent/tools/searchProducts";
import { getTroubleshootingFlow } from "@/lib/agent/tools/troubleshooting";
import {
  createConversationMemory,
  mergeConversationMemory,
  updateMemoryForAppliance,
  updateMemoryForCart,
  updateMemoryForModel,
  updateMemoryForPart,
  updateMemoryForTroubleshooting
} from "@/lib/agent/memory";
import { composeResponse } from "@/lib/llm";
import { executeModelLoop } from "@/lib/agent/model-loop";
import { executePythonGraph } from "@/lib/agent/python-graph";
import { searchKnowledge } from "@/lib/agent/tools/knowledge";
import type { AgentToolName, Source } from "@/lib/types";
import {
  compatibilitySourceTitle,
  createSource,
  installationSourceTitle,
  productSourceTitle,
  troubleshootingSourceTitle
} from "@/lib/catalog/normalize";
import {
  lookupLiveCompatibility,
  lookupLiveInstallation,
  lookupLivePart,
  lookupLiveTroubleshooting
} from "@/lib/web/grounding";

type ExecutorInput = ChatRequest & {
  history?: { role: "user" | "assistant"; content: string }[];
  cartId?: string;
  turnToken?: string;
  memory?: Partial<ConversationMemory> | null;
  onProgress?: (event: import("@/lib/types").AgentProgressEvent) => void;
};

type ExecutorOutput = {
  response: AgentResponse;
  memory: ConversationMemory;
};

type ToolResult = Record<string, unknown> | null;

function createBaseResponse(
  intent: AgentResponse["intent"],
  tool: AgentToolName,
  message: string
): AgentResponse {
  return {
    intent,
    tool,
    message
  };
}

function buildProducts(products: Product[]) {
  return products.length > 0 ? products : undefined;
}

function createFallbackClarification(message = CLARIFICATION_MESSAGE) {
  return createBaseResponse("clarification_needed", "searchProducts", message);
}

function productSource(product: Product, type: Source["type"] = "product"): Source {
  return createSource(
    type === "installation"
      ? installationSourceTitle(product)
      : type === "compatibility"
        ? compatibilitySourceTitle(product)
        : productSourceTitle(product),
    product.sourceUrl,
    type
  );
}

function troubleshootingSource(issue: string, url: string): Source {
  return createSource(troubleshootingSourceTitle({ issue }), url, "troubleshooting");
}

function notFoundMessage(query: string, partNumber: string | null) {
  return partNumber || /PS\d{8}/i.test(query) ? PART_NOT_FOUND_MESSAGE : UNKNOWN_PRODUCT_MESSAGE;
}

function lookupModeFromGrounding(status: AgentResponse["groundingStatus"]) {
  if (status === "verified_live") return "live" as const;
  if (status === "unverified") return "skipped_invalid_input" as const;
  return "demo_fallback" as const;
}

function contextUpdateMessage(modelNumber: string) {
  return `Got it — I'll use ${modelNumber} for compatibility checks.`;
}

function isCompatibilityQuestion(query: string) {
  return /\b(compatible|compatibility|fits?|work with|match my model|for my model)\b/i.test(query);
}

function isInstallationQuestion(query: string) {
  return /\b(install|installation|replace|how do i install|change out)\b/i.test(query);
}

export async function executeAgent(input: ExecutorInput): Promise<ExecutorOutput> {
  const startedAt = Date.now();
  const incomingMemory = mergeConversationMemory(createConversationMemory(), input.memory);
  if (input.currentModelNumber) incomingMemory.currentModelNumber = input.currentModelNumber;
  const query = input.message.trim();

  if (!query) {
    const response = {
      ...createBaseResponse("clarification_needed", "searchProducts", EMPTY_INPUT_MESSAGE),
      sources: []
    };
    const latencyMs = Date.now() - startedAt;
    response.responseTimeMs = latencyMs;
    response.llmUsed = false;
    response.tokens = { input: 0, output: 0, total: 0 };
    trackAgentEvent({
      query,
      intent: response.intent,
      selectedTool: response.tool,
      latencyMs,
      tokens: response.tokens,
      llmUsed: false
    });
    return {
      response,
      memory: incomingMemory
    };
  }

  const knowledgeCommand = query.match(/^(?:search knowledge|knowledge):\s*(.*)$/i);
  if (knowledgeCommand) {
    const response = searchKnowledge(knowledgeCommand[1]);
    return { response: { ...response, responseTimeMs: Date.now() - startedAt }, memory: incomingMemory };
  }
  const route = routeQuery(query, incomingMemory);

  // 只有明确操作和纯查看购物车绕过模型，避免组合咨询被 cart/buy 关键词截走。
  const command = parseCartCommand(query);
  const directCart = command || /^(?:(?:show|view|open) (?:my |the )?cart|(?:查看|刷新|打开)(?:我的)?购物车)[。！.!]?$/i.test(query);
  if (directCart) {
    if (command?.action === "add") {
      const checks = incomingMemory.currentModelNumber
        ? await runReadTool("checkCompatibility", { partNumber: command.partNumber, modelNumber: incomingMemory.currentModelNumber }, incomingMemory) : null;
      if (checks?.compatibility?.status !== "compatible" && checks) return { memory: incomingMemory, response: checks };
      const proposal = await runReadTool("prepareCartAddition", { partNumber: command.partNumber, quantity: "1" }, incomingMemory);
      return { memory: incomingMemory, response: { ...proposal, compatibility: checks?.compatibility,
        compatibilities: checks?.compatibility ? [checks.compatibility] : [], sources: checks?.sources ?? [],
        llmUsed: false, tokens: { input: 0, output: 0, total: 0 }, responseTimeMs: Date.now() - startedAt } };
    }
    const cart = await updateCart({ action: command?.action ?? null, partNumber: command?.partNumber ?? null,
      cartId: input.cartId, requestId: input.requestId, turnToken: input.turnToken });
    const memory = updateMemoryForCart(incomingMemory, cart.items.map(item => item.product_id));
    return { memory, response: { intent: "cart_action", tool: "addToCart", cart, memory,
      message: command ? `已从购物车移除 ${command.partNumber}。` : "已刷新购物车，以下为服务端当前记录。",
      llmUsed: false, tokens: { input: 0, output: 0, total: 0 }, responseTimeMs: Date.now() - startedAt } };
  }
  const chineseModel = /^(?:我的)?(?:(?:冰箱|洗碗机))?型号(?:是|为|改成|改为|[:：])\s*[A-Z0-9-]+[。！.!]?$/i.test(query) ? extractModelNumber(query) : null;
  if (chineseModel) {
    const memory = updateMemoryForModel(incomingMemory, chineseModel);
    if (route.applianceType) memory.applianceType = route.applianceType;
    return { memory, response: { intent: "context_update", tool: "updateContext", memory,
      message: `好的，后续将使用 ${chineseModel} 型号核对适配情况。`, llmUsed: false, tokens: { input: 0, output: 0, total: 0 } } };
  }
  const contextOnly = route.intent === "context_update" && /^(?:(?:my|the)\s+)?(?:(?:refrigerator|dishwasher|fridge)\s+)?model(?:\s+number)?\s*(?:is\s+|:\s*)?[A-Z0-9-]+[.!]?$/i.test(query);
  if (["tool_loop", "python_graph"].includes(process.env.AGENT_EXECUTION_MODE ?? "") && !directCart && !contextOnly) {
    const switchingAppliance = route.applianceType && incomingMemory.applianceType && route.applianceType !== incomingMemory.applianceType;
    const modelMemory = mergeConversationMemory(incomingMemory, {
      applianceType: route.applianceType ?? incomingMemory.applianceType,
      ...(switchingAppliance ? { selectedPart: null, candidates: [], currentModelNumber: null, previousTroubleshootingTopic: null, troubleshootingContext: [] } : {})
    });
    const modelInput = { message: query, memory: modelMemory, history: switchingAppliance ? [] : input.history, requestId: input.requestId, onProgress: input.onProgress };
    return process.env.AGENT_EXECUTION_MODE === "python_graph" ? executePythonGraph(modelInput) : executeModelLoop(modelInput);
  }

  let memory = incomingMemory;
  let response: AgentResponse;
  let toolResult: ToolResult = null;

  if (route.intent === "knowledge_lookup") {
    if (memory.applianceType && route.applianceType !== memory.applianceType) {
      memory = mergeConversationMemory(memory, {
        currentModelNumber: null, selectedPart: null,
        previousTroubleshootingTopic: null, troubleshootingContext: []
      });
    }
    memory = updateMemoryForAppliance(memory, route.applianceType);
    const result = searchKnowledge(query, route.applianceType);
    return { response: { ...result, memory, responseTimeMs: Date.now() - startedAt }, memory };
  }

  if (route.possiblePartNumber && route.partNumberValidationStatus !== "valid") {
    response = {
      ...createBaseResponse("clarification_needed", "searchProducts", INCOMPLETE_PART_NUMBER_MESSAGE),
      groundingStatus: "unverified",
      sources: []
    };
    const latencyMs = Date.now() - startedAt;
    response.responseTimeMs = latencyMs;
    response.llmUsed = false;
    response.tokens = { input: 0, output: 0, total: 0 };
    trackAgentEvent({
      query,
      intent: response.intent,
      selectedTool: response.tool,
      latencyMs,
      validationStatus: route.partNumberValidationStatus,
      lookupMode: "skipped_invalid_input",
      tokens: response.tokens,
      llmUsed: false
    });
    return {
      response,
      memory
    };
  }

  if (route.intent === "out_of_scope") {
    response = {
      ...createBaseResponse("out_of_scope", "none", OUT_OF_SCOPE_MESSAGE),
      sources: []
    };
    const latencyMs = Date.now() - startedAt;
    response.responseTimeMs = latencyMs;
    response.llmUsed = false;
    response.tokens = { input: 0, output: 0, total: 0 };
    trackAgentEvent({
      query,
      intent: response.intent,
      selectedTool: response.tool,
      latencyMs,
      validationStatus: route.partNumberValidationStatus,
      lookupMode: "skipped_invalid_input",
      tokens: response.tokens,
      llmUsed: false
    });
    return {
      response,
      memory
    };
  }

  if (route.intent === "context_update" && route.modelNumber) {
    memory = updateMemoryForModel(memory, route.modelNumber);
    if (route.applianceType) {
      memory = updateMemoryForAppliance(memory, route.applianceType);
    }

    response = {
      ...createBaseResponse("context_update", "updateContext", contextUpdateMessage(route.modelNumber)),
      groundingStatus: "unverified",
      memory: {
        currentModelNumber: route.modelNumber,
        applianceType: route.applianceType ?? memory.applianceType
      },
      sources: []
    };
    const latencyMs = Date.now() - startedAt;
    response.responseTimeMs = latencyMs;
    response.llmUsed = false;
    response.tokens = { input: 0, output: 0, total: 0 };
    trackAgentEvent({
      query,
      intent: response.intent,
      selectedTool: response.tool,
      latencyMs,
      validationStatus: route.partNumberValidationStatus,
      lookupMode: "skipped_context_update",
      tokens: response.tokens,
      llmUsed: false
    });
    return {
      response,
      memory
    };
  }

  if (route.intent === "clarification_needed") {
    const message =
      isCompatibilityQuestion(query) && route.partNumber
        ? `I can check compatibility for ${route.partNumber}, but I need your appliance model number first.`
        : isInstallationQuestion(query)
          ? INSTALLATION_PART_NEEDED_MESSAGE
          : CLARIFICATION_MESSAGE;

    response = {
      ...createFallbackClarification(message),
      groundingStatus: "unverified",
      sources: []
    };
    const latencyMs = Date.now() - startedAt;
    response.responseTimeMs = latencyMs;
    response.llmUsed = false;
    response.tokens = { input: 0, output: 0, total: 0 };
    trackAgentEvent({
      query,
      intent: response.intent,
      selectedTool: response.tool,
      latencyMs,
      validationStatus: route.partNumberValidationStatus,
      lookupMode: "skipped_invalid_input",
      tokens: response.tokens,
      llmUsed: false
    });
    return {
      response,
      memory
    };
  }

  if (route.selectedTool === "checkCompatibility") {
    const partNumber = route.partNumber ?? memory.selectedPart;
    const modelNumber = route.modelNumber ?? memory.currentModelNumber;

    if (!partNumber || !modelNumber) {
      response = createFallbackClarification(
        partNumber
          ? `I can check compatibility for ${partNumber}, but I need your appliance model number first.`
          : modelNumber
            ? "Please share the part number so I can check compatibility."
            : "Please share the part number and model number you want to check."
      );
      toolResult = {
        missing: {
          partNumber: !partNumber,
          modelNumber: !modelNumber
        }
      };
    } else {
      const liveResult = await lookupLiveCompatibility(partNumber, modelNumber);
      const local = liveResult.product ? null : checkCompatibility({ partNumber, modelNumber });
      const product = liveResult.product ?? local?.product ?? null;
      const compatibility = liveResult.product ? liveResult.compatibility : local!.compatibility;
      memory = updateMemoryForModel(memory, modelNumber);
      if (product) {
        memory = updateMemoryForPart(memory, product.partNumber);
        memory = updateMemoryForAppliance(memory, product.applianceType);
      }
      response = {
        ...createBaseResponse("compatibility_check", "checkCompatibility", buildCompatibilityMessage(compatibility)),
        products: product ? [product] : undefined,
        compatibility,
        sources: liveResult.product ? liveResult.sources : product ? [productSource(product, "compatibility")] : [],
        groundingStatus: liveResult.product ? liveResult.status : "demo_fallback",
        memory: {
          currentModelNumber: modelNumber,
          selectedPart: product?.partNumber ?? memory.selectedPart,
          applianceType: product?.applianceType ?? memory.applianceType
        }
      };
      toolResult = { compatibility, product };
    }
  } else if (route.selectedTool === "getInstallationGuide") {
    if (!route.partNumber && !memory.selectedPart) {
      response = createFallbackClarification(INSTALLATION_PART_NEEDED_MESSAGE);
      toolResult = {
        missing: {
          partNumber: true
        }
      };
    } else {
    const live = await lookupLiveInstallation(query);
    const product = live.product ?? lookupPart({
      query,
      applianceType: route.applianceType,
      partNumber: route.partNumber,
      selectedPart: memory.selectedPart
    }).selectedPart;

    if (!product) {
      response = createFallbackClarification(notFoundMessage(query, route.partNumber));
      toolResult = {
        found: false,
        query
      };
    } else if (live.status === "verified_live" && live.product) {
      memory = updateMemoryForPart(memory, product.partNumber);
      memory = updateMemoryForAppliance(memory, product.applianceType);
      response = {
        ...createBaseResponse(
          "installation_guide",
          "getInstallationGuide",
          buildInstallationMessage(product)
        ),
        products: [product],
        steps: product.installationSteps.slice(0, 5),
        sources: live.sources,
        groundingStatus: "verified_live",
        memory: {
          selectedPart: product.partNumber,
          applianceType: product.applianceType
        }
      };
      toolResult = {
        verified: true,
        product: {
          partNumber: product.partNumber,
          name: product.name,
          applianceType: product.applianceType
        },
        steps: product.installationSteps.slice(0, 5)
      };
    } else {
      const guide = getInstallationGuide({ product });
      memory = updateMemoryForPart(memory, product.partNumber);
      memory = updateMemoryForAppliance(memory, product.applianceType);
      response = {
        ...createBaseResponse(
          "installation_guide",
          "getInstallationGuide",
          buildInstallationMessage(product)
        ),
        products: [product],
        steps: guide.steps,
        sources: [productSource(product, "installation")],
        groundingStatus: "demo_fallback",
        memory: {
          selectedPart: product.partNumber,
          applianceType: product.applianceType
        }
      };
      toolResult = {
        verified: false,
        product: {
          partNumber: product.partNumber,
          name: product.name,
          applianceType: product.applianceType
        },
        steps: guide.steps
      };
    }
    }
  } else if (route.selectedTool === "getTroubleshootingFlow") {
    const live = await lookupLiveTroubleshooting(query, route.applianceType ?? memory.applianceType);
    const flow = getTroubleshootingFlow({
      query,
      applianceType: route.applianceType ?? memory.applianceType,
      selectedPart: memory.selectedPart,
      modelNumber: route.modelNumber ?? memory.currentModelNumber
    });

    const liveVerified = live.status === "verified_live" && live.diagnosticChecklist.length > 0;
    const selectedProduct = liveVerified
      ? null
      : flow.recommendedParts[0] ?? null;

    if (selectedProduct) {
      memory = updateMemoryForPart(memory, selectedProduct.partNumber);
      memory = updateMemoryForAppliance(memory, selectedProduct.applianceType);
    }
    memory = updateMemoryForTroubleshooting(
      memory,
      liveVerified ? [live.issue, ...live.possibleCauses] : [flow.issue, ...flow.possibleCauses],
      liveVerified ? live.issue : flow.issue
    );

    response = liveVerified
      ? {
          ...createBaseResponse(
            "troubleshooting",
            "getTroubleshootingFlow",
            buildTroubleshootingMessage(live.issue)
          ),
          sections: [
            { title: "Diagnostic Checklist", items: live.diagnosticChecklist },
            { title: "Possible Causes", items: live.possibleCauses }
          ],
          products: undefined,
          sources: live.sources,
          groundingStatus: "verified_live",
          memory: {
            troubleshootingContext: memory.troubleshootingContext,
            previousTroubleshootingTopic: live.issue,
            selectedPart: memory.selectedPart,
            applianceType: memory.applianceType
          }
        }
      : {
          ...createBaseResponse(
            "troubleshooting",
            "getTroubleshootingFlow",
            buildTroubleshootingMessage(flow.issue)
          ),
          sections: [
            { title: "Diagnostic Checklist", items: flow.diagnosticChecklist },
            { title: "Possible Causes", items: flow.possibleCauses },
            { title: "Recommended Parts", items: flow.recommendedParts.map(formatProductSummary) }
          ],
          products: buildProducts(flow.recommendedParts),
          sources: [
            troubleshootingSource(flow.issue, flow.sourceUrl),
            ...flow.recommendedParts.slice(0, 3).map((item) => productSource(item, "product"))
          ],
          groundingStatus: "demo_fallback",
          memory: {
            troubleshootingContext: memory.troubleshootingContext,
            previousTroubleshootingTopic: flow.issue,
            selectedPart: selectedProduct?.partNumber ?? memory.selectedPart,
            applianceType: selectedProduct?.applianceType ?? memory.applianceType
          }
        };
    toolResult = liveVerified
      ? {
          verified: true,
          issue: live.issue,
          diagnosticChecklist: live.diagnosticChecklist,
          possibleCauses: live.possibleCauses
        }
      : {
          verified: false,
          issue: flow.issue,
          diagnosticChecklist: flow.diagnosticChecklist,
          possibleCauses: flow.possibleCauses,
          recommendedParts: flow.recommendedParts.map((item) => ({
            partNumber: item.partNumber,
            name: item.name,
            applianceType: item.applianceType,
            brand: item.brand
          }))
        };
  } else if (route.selectedTool === "addToCart") {
    const cart = await updateCart({
      action: null,
      cartId: input.cartId,
      requestId: input.requestId,
      turnToken: input.turnToken,
      partNumber: null
    });
    memory = updateMemoryForCart(memory, cart.items.map((item) => item.product_id));
    const message = "购物车未修改。可输入“查看购物车”或“从购物车移除 配件编号”；加购需要先生成建议，再点击确认。";
    response = {
      ...createBaseResponse("cart_action", "addToCart", message),
      cart,
      memory: { cartItems: memory.cartItems },
      groundingStatus: "demo_fallback",
      llmUsed: false,
      tokens: { input: 0, output: 0, total: 0 },
      responseTimeMs: Date.now() - startedAt,
      sources: []
    };
    // 操作结果直接使用后端返回值，不让语言模型改写交易事实。
    trackAgentEvent({
      query,
      intent: response.intent,
      selectedTool: response.tool,
      latencyMs: response.responseTimeMs ?? 0,
      validationStatus: route.partNumberValidationStatus,
      lookupMode: "demo_fallback",
      tokens: { input: 0, output: 0, total: 0 },
      llmUsed: false
    });
    return { response, memory };
  } else if (route.selectedTool === "lookupPart") {
    const live = await lookupLivePart(query);
    const lookup = live.product
      ? { selectedPart: live.product }
      : lookupPart({
          query,
          applianceType: route.applianceType,
          partNumber: route.partNumber,
          selectedPart: memory.selectedPart
        });

    if (lookup.selectedPart) {
      memory = updateMemoryForPart(memory, lookup.selectedPart.partNumber);
      memory = updateMemoryForAppliance(memory, lookup.selectedPart.applianceType);
    }

    response = lookup.selectedPart
      ? {
          ...createBaseResponse("part_lookup", "lookupPart", buildLookupMessage(lookup.selectedPart)),
          products: [lookup.selectedPart],
          sources: live.product ? live.sources : [productSource(lookup.selectedPart, "product")],
          groundingStatus: live.product ? "verified_live" : "demo_fallback",
          memory: {
            selectedPart: lookup.selectedPart.partNumber,
            applianceType: lookup.selectedPart.applianceType
          }
        }
      : createFallbackClarification(notFoundMessage(query, route.partNumber));
    toolResult = lookup.selectedPart
      ? {
          verified: Boolean(live.product),
          found: true,
          product: {
            partNumber: lookup.selectedPart.partNumber,
            name: lookup.selectedPart.name,
            applianceType: lookup.selectedPart.applianceType,
            brand: lookup.selectedPart.brand
          }
        }
      : {
          found: false,
          query
        };
  } else {
    const live = await lookupLivePart(query);
    const search = live.product
      ? { matches: [live.product], selectedPart: live.product }
      : searchProducts({
          query,
          applianceType: route.applianceType,
          partNumber: route.partNumber,
          selectedPart: memory.selectedPart
        });

    response = search.matches.length
      ? {
          ...createBaseResponse("part_lookup", "searchProducts", buildLookupMessage(search.matches[0])),
          products: search.matches,
          sources: live.product
            ? live.sources
            : search.matches.slice(0, 3).map((item) => productSource(item, "product")),
          groundingStatus: live.product ? "verified_live" : "demo_fallback",
          memory: {
            selectedPart: search.selectedPart?.partNumber ?? memory.selectedPart,
            applianceType: search.selectedPart?.applianceType ?? memory.applianceType
          }
        }
      : createFallbackClarification(UNKNOWN_PRODUCT_MESSAGE);
    toolResult = {
      verified: Boolean(live.product),
      matches: search.matches.map((item) => ({
        partNumber: item.partNumber,
        name: item.name,
        applianceType: item.applianceType,
        brand: item.brand
      }))
    };
  }

  // 兼容性结论来自证据规则，不允许润色模型把“未知”改成确定结论。
  const composed = response.compatibility ? {
    message: response.message, llmUsed: false, tokens: { input: 0, output: 0, total: 0 }
  } : await composeResponse({
    query,
    intent: response.intent,
    tool: response.tool,
    toolResult,
    memory,
    baseMessage: response.message
  });

  response.message = composed.message;
  response.llmUsed = composed.llmUsed;
  response.tokens = composed.tokens;
  const latencyMs = Date.now() - startedAt;
  response.responseTimeMs = latencyMs;

  trackAgentEvent({
    query,
    intent: response.intent,
    selectedTool: response.tool,
    latencyMs,
    validationStatus: route.partNumberValidationStatus,
    lookupMode: lookupModeFromGrounding(response.groundingStatus),
    tokens: composed.tokens,
    llmUsed: composed.llmUsed
  });

  return {
    response,
    memory
  };
}
