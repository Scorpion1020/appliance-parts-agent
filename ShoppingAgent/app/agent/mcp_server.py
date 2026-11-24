"""独立 stdio MCP 服务：只读商品和知识工具，不加载密钥或模型。"""

import asyncio

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from app.agent.tools import run_tool, validate_arguments

server = FastMCP("Appliance evidence tools")
READ_ONLY = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)


async def invoke(name: str, arguments: dict) -> dict:
    return await asyncio.to_thread(run_tool, name, validate_arguments(name, arguments), {})


@server.tool(name="getProductDetails", annotations=READ_ONLY)
async def get_product_details(partNumber: str) -> dict:
    """Read a demo part's catalog price and availability; this does not prove compatibility."""
    return await invoke("getProductDetails", {"partNumber": partNumber})


@server.tool(name="searchProducts", annotations=READ_ONLY)
async def search_products(query: str) -> dict:
    """Search the local appliance parts catalog. No shopping cart changes are possible."""
    return await invoke("searchProducts", {"query": query})


@server.tool(name="searchKnowledge", annotations=READ_ONLY)
async def search_knowledge(query: str) -> dict:
    """Retrieve reviewed maintenance summaries with citations and safety limits, not a diagnosis or fit guarantee."""
    return await invoke("searchKnowledge", {"query": query})


if __name__ == "__main__":
    server.run(transport="stdio")
