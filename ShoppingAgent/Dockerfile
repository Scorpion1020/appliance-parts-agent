FROM python:3.11-slim-bookworm
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY ShoppingAgent/pyproject.toml ShoppingAgent/requirements.lock ./
COPY ShoppingAgent/app ./app
RUN pip install --no-cache-dir -r requirements.lock && pip install --no-cache-dir --no-deps .
COPY ShoppingAgent/data/parts-catalog.json ./data/parts-catalog.json
COPY ShoppingAgent/data/evidence-data.json ./data/evidence-data.json
COPY PartSelectChatAgent/data/generated/knowledge-index.json ./data/knowledge-index.json
ENV SHOPPING_AGENT_KNOWLEDGE_INDEX=/app/data/knowledge-index.json \
    SHOPPING_AGENT_EVIDENCE_PATH=/app/data/evidence-data.json
COPY ShoppingAgent/manual_ui ./manual_ui
RUN useradd --uid 10001 --create-home agent && mkdir -p /state && chown agent:agent /state
USER agent
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
