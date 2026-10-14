import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Download, Github, ShieldCheck, Terminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { fetchMeta, META_FALLBACK, type Meta } from "@/lib/meta";

function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked; the text is still selectable.
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted px-3 py-2 pr-11 text-xs leading-5">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy to clipboard"
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: "Download and unzip",
    body: (
      <>
        Download the zip and unzip it somewhere you will keep it, like your
        Documents folder. Keep that folder around, because the browser loads the
        extension from it.
      </>
    ),
  },
  {
    title: "Open the extensions page",
    body: (
      <>
        Go to <code className="rounded bg-muted px-1">chrome://extensions</code>{" "}
        (or <code className="rounded bg-muted px-1">edge://extensions</code>) and
        switch on <em>Developer mode</em> in the top right corner.
      </>
    ),
  },
  {
    title: "Load unpacked",
    body: (
      <>
        Click <em>Load unpacked</em> and pick the unzipped folder, the one that
        holds{" "}
        <code className="rounded bg-muted px-1">manifest.json</code>. The Raven Scheduling
        icon shows up in your toolbar.
      </>
    ),
  },
];

export default function InstallPage() {
  const [meta, setMeta] = useState<Meta>(META_FALLBACK);

  useEffect(() => {
    fetchMeta().then(setMeta);
  }, []);

  const config = meta;
  const label = config.chrome_store_url ? "Add to Chrome" : "Download";

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        meta={config}
        installHref={config.chrome_store_url || config.extension_download_url}
        installLabel={label}
      />

      <main className="flex-1">
        <section className="container max-w-3xl py-14">
          <Badge variant="secondary" className="w-fit">
            No store needed
          </Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Install Raven Scheduling
          </h1>
          <p className="mt-3 text-muted-foreground">
            Raven Scheduling is not in a browser store yet, so you install it yourself.
            It takes about a minute, and it runs in Chrome and Edge on Windows,
            macOS and Linux.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href={config.extension_download_url}>
                <Download className="h-4 w-4" />
                Download the extension
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={config.github_url}>
                <Github className="h-4 w-4" />
                View the code
              </a>
            </Button>
          </div>

          <Card className="mt-10">
            <CardHeader>
              <CardTitle className="text-lg">Three steps</CardTitle>
              <CardDescription>Once the zip is on your computer.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-5">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-medium">
                      {index + 1}
                    </span>
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{step.title}</p>
                      <p className="text-sm text-muted-foreground">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <div className="mt-6 flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
            <p>
              Chrome may show a notice about developer mode extensions. That is
              normal for anything not installed from a store. Raven Scheduling stays
              installed after you restart the browser, and it runs the same code
              you can read in the repository.
            </p>
          </div>

          <Card className="mt-10">
            <CardHeader>
              <Terminal className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="pt-2 text-lg">Prefer a script?</CardTitle>
              <CardDescription>
                It downloads the latest version, unpacks it to a stable folder
                and opens the extensions page for you.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Windows (PowerShell)</p>
                <CopyableCode
                  code={`irm ${config.extension_installer_ps1_url} | iex`}
                />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">macOS and Linux</p>
                <CopyableCode
                  code={`curl -fsSL ${config.extension_installer_sh_url} | bash`}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                You can read both scripts in{" "}
                <code className="rounded bg-muted px-1">scripts/</code> before
                running them.
              </p>
            </CardContent>
          </Card>

          <Card className="mt-10">
            <CardHeader>
              <CardTitle className="text-lg">Build from source</CardTitle>
              <CardDescription>For anyone who also wants the backend.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <CopyableCode
                code={`git clone ${config.github_url}.git\ncd ravennow`}
              />
              <p>
                Then load the{" "}
                <code className="rounded bg-muted px-1">extension/</code> folder
                the same way as step 3.
              </p>
            </CardContent>
          </Card>

          <p className="mt-8 text-sm text-muted-foreground">
            A store listing may come later. When it does, this page will link to
            it. For now you can also open the{" "}
            <a
              className="font-medium text-foreground underline underline-offset-4"
              href="/app"
            >
              dashboard
            </a>{" "}
            or read the{" "}
            <a
              className="font-medium text-foreground underline underline-offset-4"
              href="/privacy"
            >
              privacy policy
            </a>
            .
          </p>
        </section>
      </main>

      <SiteFooter meta={config} />
    </div>
  );
}
