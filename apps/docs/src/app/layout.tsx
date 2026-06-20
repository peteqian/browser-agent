import { Inter } from "next/font/google";
import { Provider } from "@/components/provider";
import { basePath } from "@/lib/shared";
import "./global.css";

const inter = Inter({
  subsets: ["latin"],
});

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        {/* Make the LLM-friendly docs discoverable by agents crawling the site. */}
        <link rel="alternate" type="text/plain" title="llms.txt" href={`${basePath}/llms.txt`} />
        <link
          rel="alternate"
          type="text/plain"
          title="llms-full.txt"
          href={`${basePath}/llms-full.txt`}
        />
      </head>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
