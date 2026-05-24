import type { Metadata } from "next";
import { Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";
import { RoleProvider } from "@/providers/RoleProvider";

const arabic = Noto_Sans_Arabic({ subsets: ["arabic"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "تطوير تالنت - نظام الموارد البشرية",
  description: "نظام موارد بشرية متقدم للفرق الميدانية",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={arabic.variable}>
      <body className="font-sans antialiased">
        <RoleProvider>
          {children}
        </RoleProvider>
      </body>
    </html>
  );
}
