from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.agent.provider import close_http_client
from app.agent.router import router as agent_router
from app.cart.router import router as cart_router
from app.catalog.router import router as catalog_router
from app.config import PROJECT_ROOT
from app.conversation.router import router as conversation_router
from app.shared.errors import register_error_handlers


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await close_http_client()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Shopping Agent Tool Layer",
        version="0.2.0",
        description="FastAPI + LangGraph backend for appliance parts lookup, grounded Q&A, and confirmation-gated cart actions.",
        lifespan=lifespan,
    )
    register_error_handlers(app)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(catalog_router)
    app.include_router(cart_router)
    app.include_router(conversation_router)
    app.include_router(agent_router)
    app.mount("/ui", StaticFiles(directory=PROJECT_ROOT / "manual_ui", html=True), name="manual-ui")
    return app


app = create_app()
