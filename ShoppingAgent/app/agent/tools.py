import math
import re

from app.catalog.models import ProductSummary
from app.catalog.router import get_catalog_service
from app.agent.knowledge import search_knowledge
from app.agent.evidence import run_evidence_tool


def definition(name: str, description: str, properties: dict) -> dict:
    return {"type": "function", "function": {"name": name, "description": description,
        "parameters": {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False}}}


TOOLS = [
    definition("checkCompatibility", "Check evidence for an exact part and model. Unknown or demo evidence never proves fit.", {"partNumber": {"type": "string"}, "modelNumber": {"type": "string"}}),
    definition("prepareCartAddition", "READ ONLY: propose an explicitly requested addition for user confirmation, never write a cart. Quantity is an integer string 1-20. Check any known model first; unknown fit blocks proposals.", {"partNumber": {"type": "string"}, "quantity": {"type": "string"}}),
    definition("getInstallationGuide", "Read DEMONSTRATION installation steps, not verified repair instructions.", {"partNumber": {"type": "string"}}),
    definition("getTroubleshootingFlow", "Read a DEMONSTRATION diagnostic checklist. Prefer searchKnowledge for source-backed maintenance guidance.", {"query": {"type": "string"}}),
    definition("searchKnowledge", "Search reviewed manufacturer maintenance summaries in English. Returns citations and safety limits, never compatibility proof.", {"query": {"type": "string"}}),
    definition("searchProducts", "Read the demo catalog. Search first if an exact canonical part number is unknown.", {"query": {"type": "string"}}),
    definition("getProductDetails", "Read demo catalog details and price for an exact part ID. Does not prove compatibility.", {"partNumber": {"type": "string"}}),
    definition("finish", "Select successful result IDs for server rendering, or ask for missing information. Never invent an answer.", {
        "resultIds": {"type": "array", "items": {"type": "string"}},
        "missing": {"type": "string", "enum": ["none", "part", "model", "symptom", "out_of_scope"]}}),
]


def product_view(item: ProductSummary) -> dict:
    if item.category not in ("refrigerator", "dishwasher") or item.currency != "USD":
        raise ValueError("The Python service must use the appliance parts catalog.")
    price = float(item.price) if item.price is not None else None
    if price is not None and (not math.isfinite(price) or price < 0):
        raise ValueError("Invalid catalog price.")
    return {
        "partNumber": item.id, "manufacturerPartNumber": item.manufacturer_part_number or item.id,
        "name": item.name, "description": getattr(item, "description", None) or "Catalog entry; verify details with the manufacturer.",
        "applianceType": item.category, "brand": item.brand or "Unknown", "price": price,
        "availability": "Out of stock" if not item.available or item.stock_qty == 0 else "Unknown" if item.stock_qty is None else "In stock",
        "compatibleModels": [], "symptoms": item.symptoms, "installationSteps": [],
        "sourceUrl": item.source_url, "sourceType": "product", "catalogOrigin": item.data_origin,
        "purchasable": item.available and price is not None and (item.stock_qty is None or item.stock_qty > 0),
    }


def validate_arguments(name: str, args: object) -> dict:
    fields = {"searchProducts": ["query"], "getProductDetails": ["partNumber"], "searchKnowledge": ["query"],
              "checkCompatibility": ["partNumber", "modelNumber"], "prepareCartAddition": ["partNumber", "quantity"],
              "getInstallationGuide": ["partNumber"], "getTroubleshootingFlow": ["query"]}
    if name not in fields:
        raise ValueError("Unknown tool. Only listed read tools and finish are available.")
    if not isinstance(args, dict) or set(args) != set(fields[name]):
        raise ValueError("Supply exactly the required string fields.")
    normalized = {}
    for field in fields[name]:
        if not isinstance(args[field], str):
            raise ValueError("Arguments must be strings.")
        value = args[field].strip()
        if not value or len(value) > (1000 if field == "query" else 64):
            raise ValueError("Tool argument is empty or too long.")
        if field == "quantity":
            if not re.fullmatch(r"[0-9]{1,2}", value) or not 1 <= int(value) <= 20:
                raise ValueError("Quantity must be an integer from 1 to 20.")
        elif field != "query":
            value = value.upper()
            if not re.fullmatch(r"[A-Z0-9-]+", value) or not re.search(r"\d", value):
                raise ValueError("Use the complete alphanumeric part or model number.")
            if field == "partNumber" and value.startswith("PS") and not re.fullmatch(r"PS\d{8}", value):
                raise ValueError("Use a complete PartSelect part number.")
        normalized[field] = value
    return normalized


def run_tool(name: str, args: dict, memory: dict) -> dict:
    if name == "searchKnowledge":
        return search_knowledge(args["query"], memory.get("applianceType"))
    if name in {"checkCompatibility", "getInstallationGuide", "getTroubleshootingFlow"}:
        return run_evidence_tool(name, args, memory)
    service = get_catalog_service()
    if name == "prepareCartAddition":
        product = product_view(service.get_product_details(args["partNumber"]))
        if not product["purchasable"] or product["price"] is None:
            raise ValueError("This catalog product is not available for addition.")
        quantity = int(args["quantity"])
        return {"intent": "cart_action", "tool": name, "groundingStatus": "unverified",
                "message": f"Review before confirming: add {quantity} × {product['name']} ({product['partNumber']}). Catalog unit price: USD {product['price']:.2f}. No cart change has been made; this is not a compatibility guarantee.",
                "products": [product], "cartProposal": {"partNumber": product["partNumber"], "quantity": quantity, "name": product["name"], "unitPrice": product["price"]}}
    if name == "getProductDetails":
        products = [product_view(service.get_product_details(args["partNumber"]))]
    else:
        query = args["query"]
        query = re.sub(r"\b(parts?|products?|catalog)\b", " ", query, flags=re.I).strip()
        query = re.sub(r"\bfridge\b", "refrigerator", query, flags=re.I)
        category = "dishwasher" if "dishwasher" in query.lower() else "refrigerator" if re.search(r"fridge|refrigerator", query, re.I) else memory.get("applianceType")
        if re.search(r"\b[A-Z]*\d[A-Z0-9-]{4,}\b", query, re.I):
            category = None
        products = [product_view(item) for item in service.search_products(q=query, category=category, available_only=False, limit=5).results]
    lines = [f"{item['name']} ({item['partNumber']}). Demo catalog price: " +
             (f"USD {item['price']:.2f}" if item["price"] is not None else "unknown") +
             f". Availability: {item['availability']}. This is not compatibility evidence." for item in products]
    return {"intent": "part_lookup", "tool": name, "message": "\n".join(lines) or "No matching catalog product was found.",
        "products": products, "groundingStatus": "unverified", "sources": []}
