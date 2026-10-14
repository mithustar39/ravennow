import { Wordmark } from "@/components/site/brand";
import type { Meta } from "@/lib/meta";

export function SiteFooter({ meta }: { meta: Meta }) {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container flex flex-col gap-6 py-10 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Wordmark />
          <p className="max-w-xl text-sm text-muted-foreground">
            Raven Scheduling is an independent student project and is not affiliated
            with or endorsed by D2L Corporation or Carleton University.
            &ldquo;Brightspace&rdquo; is a product of D2L Corporation.
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <a className="transition-colors hover:text-foreground" href="/privacy">
            Privacy
          </a>
          {meta.support_email ? (
            <a
              className="transition-colors hover:text-foreground"
              href={`mailto:${meta.support_email}`}
            >
              {meta.support_email}
            </a>
          ) : null}
          {meta.github_url ? (
            <a
              className="transition-colors hover:text-foreground"
              href={meta.github_url}
            >
              GitHub
            </a>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
