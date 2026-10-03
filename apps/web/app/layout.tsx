import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Noto_Sans_Sinhala } from "next/font/google";
import "../styles/globals.css";

const atkinson = Atkinson_Hyperlegible({
  variable: "--font-atkinson",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

const notoSansSinhala = Noto_Sans_Sinhala({
  variable: "--font-sinhala",
  subsets: ["sinhala"],
  weight: "variable",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cosmetics.lk Online Exam",
  description: "Cosmetics.lk online examination platform",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${atkinson.variable} ${notoSansSinhala.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
