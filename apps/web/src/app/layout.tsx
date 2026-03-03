import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JSMath - 수학 문제은행 + LMS",
  description: "교재 PDF에서 수학 문제를 자동 추출하여 LMS와 연동하는 플랫폼",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
