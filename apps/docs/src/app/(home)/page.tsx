import Link from "next/link";
import { basePath } from "@/lib/shared";

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">browser-agent</h1>
      <p className="mb-8 max-w-2xl text-lg text-fd-muted-foreground">
        TypeScript browser automation driven by an LLM decision loop over raw Chrome DevTools
        Protocol. Give it a task in plain language; it observes the page, decides the next action,
        and repeats until done.
      </p>

      <div className="mb-12 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-5 py-2.5 font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
        >
          Read the docs
        </Link>
        <a
          href="https://github.com/peteqian/browser-agent"
          className="rounded-lg border border-fd-border px-5 py-2.5 font-medium transition-colors hover:bg-fd-accent"
        >
          GitHub
        </a>
      </div>

      <div className="text-sm text-fd-muted-foreground">
        <p className="mb-2 font-medium">For LLMs &amp; agents</p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <a href={`${basePath}/llms.txt`} className="underline hover:text-fd-foreground">
            /llms.txt
          </a>
          <a href={`${basePath}/llms-full.txt`} className="underline hover:text-fd-foreground">
            /llms-full.txt
          </a>
        </div>
      </div>
    </main>
  );
}
