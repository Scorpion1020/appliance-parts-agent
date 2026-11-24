from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from app.conversation.models import ConversationMemory


Memory = ConversationMemory


class HistoryMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(max_length=1800)


class AgentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=4000)
    memory: Memory = Field(default_factory=Memory)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=8)
    runId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
