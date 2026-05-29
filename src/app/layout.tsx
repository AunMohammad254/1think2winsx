import type { Metadata } from "next";
import { Geist, Poppins, Montserrat } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import Navbar from "@/components/Navbar";
import { Toaster } from "sonner";
import { WebVitals } from "@/components/analytics/WebVitals";
import { Suspense } from "react";
import dynamic from "next/dynamic";

const Footer = dynamic(() => import("@/components/Footer"));
import ChatbotLoader from "@/components/chatbot/ChatbotLoader";




const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: 'swap',
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: 'swap',
});

export const metadata: Metadata = {
  title: "1Think 2Win",
  description: "1Think 2Win - Test your cricket knowledge and win exciting prizes!",
  icons: {
    icon: [
      { url: '/Favicon/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/Favicon/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/Favicon/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      { rel: 'manifest', url: '/Favicon/site.webmanifest' },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${poppins.variable} ${montserrat.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>
          <Suspense fallback={null}>
            <WebVitals />
          </Suspense>
          <Toaster position="top-right" richColors closeButton />
          <div className="min-h-screen flex flex-col">
            <Navbar />
            <main className="flex-grow">{children}</main>
            <Footer />
          </div>
          <ChatbotLoader />
        </Providers>
      </body>
    </html>
  );
}
