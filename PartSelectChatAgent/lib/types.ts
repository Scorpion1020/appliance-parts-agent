export type AgentIntent =
  | "knowledge_lookup"
  | "part_lookup"
  | "compatibility_check"
  | "installation_guide"
  | "troubleshooting"
  | "cart_action"
  | "context_update"
  | "out_of_scope"
  | "clarification_needed";

export type AgentToolName =
  | "getProductDetails"
  | "prepareCartAddition"
  | "searchKnowledge"
  | "searchProducts"
  | "lookupPart"
  | "checkCompatibility"
  | "getInstallationGuide"
  | "getTroubleshootingFlow"
  | "addToCart"
  | "updateContext"
  | "none";

export type ApplianceType = "refrigerator" | "dishwasher";

export type Availability = "In stock" | "Limited stock" | "Out of stock" | "Unknown";

export type Product = {
  purchasable?: boolean;
  catalogOrigin?: string;
  partNumber: string;
  manufacturerPartNumber: string;
  name: string;
  description: string;
  applianceType: ApplianceType;
  brand: string;
  price: number | null;
  availability: Availability;
  compatibleModels: string[];
  symptoms: string[];
  installationSteps: string[];
  sourceUrl: string;
  sourceType: Source["type"];
  imageUrl?: string;
};

export type ConversationMemory = {
  currentModelNumber: string | null;
  applianceType: ApplianceType | null;
  selectedPart: string | null;
  candidates?: { partNumber: string; manufacturerPartNumber: string; name: string }[];
  previousTroubleshootingTopic: string | null;
  troubleshootingContext: string[];
  cartItems: string[];
};

export type CompatibilityResult = {
  partNumber: string;
  modelNumber: string;
  status: "compatible" | "incompatible" | "unknown";
  reason: "supported" | "explicit_exclusion" | "conflicting_evidence" | "demo_only" | "no_evidence";
  evidence: CompatibilityEvidence[];
  nextAction: string;
};

export type CompatibilityEvidence = {
  partNumber: string;
  modelNumber: string;
  verdict: "compatible" | "incompatible";
  excerpt: string;
  source: Source;
};

export type ResponseSection = {
  title: string;
  items: string[];
};

export type Source = {
  origin?: "live" | "demo" | "reviewed";
  retrievedAt?: string;
  title: string;
  url: string;
  type: "product" | "installation" | "troubleshooting" | "compatibility";
};

export type AgentTraceStep = {
  model?: string;
  quotaSkippedModels?: string[];
  id: string;
  tool: string;
  arguments?: Record<string, string>;
  status: "ok" | "error";
  error?: string;
  elapsedMs: number;
};

export type AgentProgressEvent = {
  type?: string;
  stage: string;
  label: string;
  step?: number;
  tool?: string;
};

export type AgentResponse = {
  cartProposal?: { partNumber: string; quantity: number; name: string; unitPrice: number; requestId?: string; confirmationId?: string; modelNumber?: string | null; applianceType?: ApplianceType | null };
  groundedSummary?: string;
  knowledge?: import("@/lib/knowledge/types").KnowledgeSearch[];
  executionMode?: "tool_loop" | "python_graph";
  runId?: string;
  trace?: AgentTraceStep[];
  cart?: CartSnapshot;
  message: string;
  intent: AgentIntent;
  tool: AgentToolName;
  groundingStatus?: "verified_live" | "demo_fallback" | "unverified" | "searching";
  llmUsed?: boolean;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  products?: Product[];
  steps?: string[];
  compatibility?: CompatibilityResult;
  compatibilities?: CompatibilityResult[];
  sections?: ResponseSection[];
  memory?: Partial<ConversationMemory>;
  responseTimeMs?: number;
  sources?: Source[];
};

export type ChatRequest = {
  requestId?: string;
  message: string;
  currentModelNumber?: string | null;
  memory?: Partial<ConversationMemory> | null;
};

export type TurnFeedback = {
  rating: "up" | "down";
  reason?: string | null;
};

export type SessionMetrics = {
  totalTurns: number;
  completedTurns: number;
  completionRate: number;
  cartProposals: number;
  confirmedAdditions: number;
  totalTokens: number;
  avgLatencyMs: number;
  feedback: {
    up: number;
    down: number;
    reasons: Record<string, number>;
  };
};

export type ConversationState = {
  memory: ConversationMemory;
  version: number;
  turns: {
    request_id: string;
    message: string;
    status: "running" | "completed" | "failed";
    response: AgentResponse | null;
    error: string | null;
    started_at: number;
    feedback?: TurnFeedback | null;
  }[];
};

export type CartSnapshot = {
  id: string;
  items: {
    product_id: string;
    name: string;
    quantity: number;
    unit_price: string | null;
    line_total: string | null;
    currency: string;
    available: boolean;
    stock_qty: number | null;
  }[];
  item_count: number;
  subtotal: string;
  currency: string | null;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: AgentResponse;
  feedback?: TurnFeedback | null;
};

export type TroubleshootingGuide = {
  issue: string;
  keywords: string[];
  diagnosticFlow: string[];
  possibleCauses: string[];
  likelyParts: string[];
  sourceUrl: string;
  sourceType: "troubleshooting";
};
