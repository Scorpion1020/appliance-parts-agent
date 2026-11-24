import { NextRequest, NextResponse } from "next/server";

const requests = new Map<string, { count: number; until: number }>();

function equalSecret(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
  const password = process.env.DEMO_ACCESS_PASSWORD;
  if (password) {
    const expected = "Basic " + btoa(`${process.env.DEMO_ACCESS_USER ?? "demo"}:${password}`);
    if (!equalSecret(request.headers.get("authorization") ?? "", expected)) {
      return new NextResponse("请输入演示访问账号和密码。", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Agent demo", charset="UTF-8"', "Content-Type": "text/plain; charset=utf-8" } });
    }
  }
  if (request.method === "POST" && request.nextUrl.pathname === "/api/chat") {
    const origin = request.headers.get("origin");
    // Next 可能把内部 URL 标准化为 localhost；浏览器使用真实 Host。
    const expectedOrigin = process.env.APP_ORIGIN ?? `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`;
    if (origin && origin !== expectedOrigin) return NextResponse.json({ message: "不允许来自其他网站的写入请求。" }, { status: 403 });
    const now = Date.now();
    for (const [key, value] of requests) if (value.until <= now) requests.delete(key);
    const key = request.cookies.get("shopping_cart")?.value ?? "uninitialized";
    if (!requests.has(key) && requests.size >= 1000) return NextResponse.json({ message: "演示服务繁忙，请稍后重试。" }, { status: 429 });
    const window = requests.get(key) ?? { count: 0, until: now + 60_000 };
    if (window.count >= 20) return NextResponse.json({ message: "每个会话每分钟最多发送 20 次请求，请稍后重试。", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((window.until - now) / 1000))) } });
    window.count += 1;
    requests.set(key, window);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
