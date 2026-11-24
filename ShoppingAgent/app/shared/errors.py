from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class AgentError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = {}


class AgentToolError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def error_response(error: AgentToolError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"error": AgentError(code=error.code, message=error.message, details=error.details).model_dump()},
    )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AgentToolError)
    async def agent_tool_error_handler(_: Request, exc: AgentToolError) -> JSONResponse:
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": {
                    "code": "invalid_request",
                    "message": "Request validation failed.",
                    "details": {"errors": exc.errors()},
                }
            },
        )
