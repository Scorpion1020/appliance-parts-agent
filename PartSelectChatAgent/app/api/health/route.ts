import { NextResponse } from "next/server";
import { shoppingRequest } from "@/lib/shopping";

export async function GET() {
  try {
    await shoppingRequest("/health");
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "backend_unavailable" }, { status: 503 });
  }
}
