import { Github } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/site/brand";
import type { Meta } from "@/lib/meta";

interface SiteHeaderProps {
  meta: Meta;
  installHref: string;
  installLabel?: string;
}

export function SiteHeader({
  meta,
  installHref,
  installLabel = "Install RavenNow",
}: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <a href="/" className="flex items-center">
          <Wordmark />
        </a>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a className="transition-colors hover:text-foreground" href="/#how">
            How it works
          </a>
          <a className="transition-colors hover:text-foreground" href="/#install">
            Install
          </a>
          <a className="transition-colors hover:text-foreground" href="/#feedback">
            Feedback
          </a>
          <a className="transition-colors hover:text-foreground" href="/app">
            Dashboard
          </a>
        </nav>
        <div className="flex items-center gap-3">
          {meta.github_url ? (
            <a
              href={meta.github_url}
              className="hidden text-muted-foreground transition-colors hover:text-foreground sm:block"
              aria-label="GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
          ) : null}
          <Button asChild size="sm">
            <a href={installHref}>{installLabel}</a>
          </Button>
        </div>
      </div>
    </header>
  );
}
