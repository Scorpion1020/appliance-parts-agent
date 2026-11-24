"""通过真实 stdio 客户端验证工具发现、调用和写工具拒绝，不调用模型。"""

import asyncio
import json
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parameters = StdioServerParameters(command=sys.executable, args=["-m", "app.agent.mcp_server"], cwd=str(root),
        env={"PYTHONDONTWRITEBYTECODE": "1", "SHOPPING_AGENT_CATALOG_PATH": str(root / "data/parts-catalog.json")})
    async with asyncio.timeout(30):
        async with stdio_client(parameters) as (reader, writer):
            async with ClientSession(reader, writer) as session:
                await session.initialize()
                discovered = await session.list_tools()
                assert {tool.name for tool in discovered.tools} == {"getProductDetails", "searchProducts", "searchKnowledge"}
                assert all(tool.annotations and tool.annotations.readOnlyHint for tool in discovered.tools)
                for name, arguments, expected in [
                    ("getProductDetails", {"partNumber": "PS11752778"}, "39.99"),
                    ("searchProducts", {"query": "PS11752778"}, "PS11752778"),
                    ("searchKnowledge", {"query": "Whirlpool dishwasher removable filter cleaning"}, "whirlpool-dishwasher-filter"),
                ]:
                    result = await session.call_tool(name, arguments)
                    assert not result.isError
                    assert expected in json.dumps(result.model_dump())
                forbidden = await session.call_tool("addToCart", {"partNumber": "PS11752778"})
                assert forbidden.isError
    print(json.dumps({"passed": True, "transport": "stdio", "readTools": 3, "writeToolRejected": True}))


if __name__ == "__main__":
    asyncio.run(main())
