from fastapi import APIRouter, Depends

from app.cart import router as cart_routes
from app.conversation.models import BeginTurn, CompleteTurn, FailTurn, TurnFeedback
from app.conversation.repository import ConversationRepository


router = APIRouter(prefix="/carts/{cart_id}/conversation", tags=["conversation"])


def get_repository():
    return ConversationRepository(cart_routes.get_cart_repository())


@router.get("")
def get_conversation(cart_id: str, repository: ConversationRepository = Depends(get_repository)):
    return repository.get(cart_id)


@router.post("/turns")
def begin_turn(cart_id: str, request: BeginTurn, repository: ConversationRepository = Depends(get_repository)):
    return repository.begin(cart_id, request)


@router.put("/turns/{request_id}")
def complete_turn(cart_id: str, request_id: str, request: CompleteTurn, repository: ConversationRepository = Depends(get_repository)):
    return repository.complete(cart_id, request_id, request)


@router.post("/turns/{request_id}/fail")
def fail_turn(cart_id: str, request_id: str, request: FailTurn, repository: ConversationRepository = Depends(get_repository)):
    return repository.fail(cart_id, request_id, request)


@router.post("/turns/{request_id}/feedback")
def submit_feedback(cart_id: str, request_id: str, request: TurnFeedback, repository: ConversationRepository = Depends(get_repository)):
    return repository.record_feedback(cart_id, request_id, request)


@router.get("/metrics")
def get_metrics(cart_id: str, repository: ConversationRepository = Depends(get_repository)):
    return repository.metrics(cart_id)
