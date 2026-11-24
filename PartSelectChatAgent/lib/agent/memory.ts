import type { ApplianceType, ConversationMemory } from "@/lib/types";

export function createConversationMemory(): ConversationMemory {
  return {
    currentModelNumber: null,
    applianceType: null,
    selectedPart: null,
    candidates: [],
    previousTroubleshootingTopic: null,
    troubleshootingContext: [],
    cartItems: []
  };
}

export function mergeConversationMemory(
  memory: ConversationMemory,
  patch: Partial<ConversationMemory> | null | undefined
): ConversationMemory {
  if (!patch) return memory;

  return {
    currentModelNumber: patch.currentModelNumber === undefined ? memory.currentModelNumber : patch.currentModelNumber,
    applianceType: patch.applianceType === undefined ? memory.applianceType : patch.applianceType,
    selectedPart: patch.selectedPart === undefined ? memory.selectedPart : patch.selectedPart,
    candidates: patch.candidates ?? memory.candidates ?? [],
    previousTroubleshootingTopic:
      patch.previousTroubleshootingTopic === undefined ? memory.previousTroubleshootingTopic : patch.previousTroubleshootingTopic,
    troubleshootingContext: patch.troubleshootingContext ?? memory.troubleshootingContext,
    cartItems: patch.cartItems ?? memory.cartItems
  };
}

export function updateMemoryForAppliance(memory: ConversationMemory, applianceType: ApplianceType | null) {
  return mergeConversationMemory(memory, { applianceType });
}

export function updateMemoryForPart(memory: ConversationMemory, partNumber: string | null) {
  return mergeConversationMemory(memory, { selectedPart: partNumber });
}

export function updateMemoryForModel(memory: ConversationMemory, modelNumber: string | null) {
  const normalized = modelNumber?.trim().toUpperCase() ?? null;
  return mergeConversationMemory(memory, { currentModelNumber: normalized,
    ...(normalized !== memory.currentModelNumber ? { candidates: [], troubleshootingContext: [], previousTroubleshootingTopic: null } : {}) });
}

export function updateMemoryForTroubleshooting(
  memory: ConversationMemory,
  troubleshootingContext: string[],
  previousTroubleshootingTopic?: string | null
) {
  return mergeConversationMemory(memory, {
    previousTroubleshootingTopic:
      previousTroubleshootingTopic ?? memory.previousTroubleshootingTopic,
    troubleshootingContext: Array.from(
      new Set([...memory.troubleshootingContext, ...troubleshootingContext])
    ).slice(-40)
  });
}

export function updateMemoryForCart(memory: ConversationMemory, cartItems: string[]) {
  return mergeConversationMemory(memory, {
    cartItems: Array.from(new Set(cartItems))
  });
}
