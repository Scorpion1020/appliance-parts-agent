import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "家电配件智能助手",
  description: "支持中文咨询的冰箱与洗碗机配件助手，提供配件查询、型号适配、维护指导与确认式购物。"
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
