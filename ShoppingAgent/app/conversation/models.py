from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue


RequestId = Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


class Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    partNumber: str = Field(min_length=1, max_length=128)
    manufacturerPartNumber: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=500)


class ConversationMemory(BaseModel):
    model_config = ConfigDict(extra="forbid")
    currentModelNumber: str | None = Field(default=None, max_length=64)
    applianceType: Literal["refrigerator", "dishwasher"] | None = None
    selectedPart: str | None = Field(default=None, max_length=128)
    candidates: list[Candidate] = Field(default_factory=list, max_length=5)
    previousTroubleshootingTopic: str | None = Field(default=None, max_length=1000)
    troubleshootingContext: list[Annotated[str, Field(max_length=2000)]] = Field(default_factory=list, max_length=40)
    cartItems: list[Annotated[str, Field(max_length=128)]] = Field(default_factory=list, max_length=1000)


class BeginTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: RequestId
    message: str = Field(min_length=1, max_length=4000, pattern=r"\S")


class CompleteTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=1, max_length=128)
    memory: ConversationMemory
    response: dict[str, JsonValue]


class TraceStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str | None = Field(default=None, max_length=128)
    quotaSkippedModels: list[Annotated[str, Field(max_length=128)]] = Field(default_factory=list, max_length=4)
    id: str = Field(min_length=1, max_length=128)
    tool: str = Field(min_length=1, max_length=128)
    arguments: dict[str, Annotated[str, Field(max_length=1000)]] | None = None
    status: Literal["ok", "error"]
    error: str | None = Field(default=None, max_length=500)
    elapsedMs: int = Field(ge=0)


class TokenUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input: int = Field(ge=0)
    output: int = Field(ge=0)
    total: int = Field(ge=0)


class RunDiagnostics(BaseModel):
    model_config = ConfigDict(extra="forbid")
    executionMode: Literal["tool_loop", "python_graph"] = "tool_loop"
    trace: list[TraceStep] = Field(max_length=7)
    tokens: TokenUsage
    responseTimeMs: int = Field(ge=0)


class FailTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(min_length=1, max_length=128)
    error: str = Field(min_length=1, max_length=500)
    diagnostics: RunDiagnostics | None = None


class TurnFeedback(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rating: Literal["up", "down"]
    reason: Literal["not_found", "compatibility_unclear", "slow_response", "inaccurate", "other"] | None = None
    comment: str | None = Field(default=None, max_length=500)
