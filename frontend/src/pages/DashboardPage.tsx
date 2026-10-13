import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import {
  checkDeadline,
  formatDateTime,
  getChanges,
  getDeadlines,
  seedDemoData,
  type ChangeEvent,
  type Deadline,
} from "@/lib/api";
import { fetchMeta, type Meta } from "@/lib/meta";

const KIND_LABEL: Record<string, string> = {
  added: "New deadline",
  due_changed: "Due date changed",
  due_removed: "Due date removed",
  due_added: "Due date added",
  submitted: "Submitted",
};

function startOfWeek(date: Date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

function groupByWeek(deadlines: Deadline[]) {
  const groups = new Map<string, Deadline[]>();
  for (const deadline of deadlines) {
    const key = deadline.due_at
      ? startOfWeek(new Date(deadline.due_at)).toISOString()
      : "none";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(deadline);
  }
  return [...groups.keys()].sort().map((key) => ({
    key,
    label:
      key === "none"
        ? "No due date"
        : "Week of " +
          new Date(key).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
    items: groups.get(key)!,
  }));
}

export default function DashboardPage() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [token, setToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [changes, setChanges] = useState<ChangeEvent[]>([]);

  const load = useCallback(async (value: string) => {
    if (!value) return;
    setLoading(true);
    setError(false);
    try {
      const [d, c] = await Promise.all([getDeadlines(value), getChanges(value)]);
      setDeadlines(d);
      setChanges(c);
      setConnected(true);
      setMessage("");
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      setConnected(false);
      setError(true);
      setMessage(
        status === 401
          ? "That token was not accepted. Copy it again from the extension options."
          : "Could not reach the server."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMeta().then(setMeta);
    const saved = localStorage.getItem("ravennow_token") || "";
    if (saved) {
      setToken(saved);
      void load(saved);
    }
  }, [load]);

  function connect() {
    const value = token.trim();
    localStorage.setItem("ravennow_token", value);
    void load(value);
  }

  async function toggle(deadline: Deadline, checked: boolean) {
    setDeadlines((prev) =>
      prev.map((d) => (d.id === deadline.id ? { ...d, checked } : d))
    );
    try {
      await checkDeadline(token, deadline.id, checked);
    } catch {
      setDeadlines((prev) =>
        prev.map((d) => (d.id === deadline.id ? { ...d, checked: !checked } : d))
      );
    }
  }

  async function loadDemo() {
    try {
      await seedDemoData(token);
      await load(token);
    } catch {
      setError(true);
      setMessage("Demo data is unavailable here.");
    }
  }

  const isProduction = meta?.environment === "production";

  return (
    <div className="flex min-h-screen flex-col">
      {meta ? <SiteHeader meta={meta} installHref="/#install" /> : null}

      <main className="container max-w-4xl flex-1 py-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Your deadlines
            </h1>
            <p className="text-sm text-muted-foreground">
              Works with the same anonymous token the extension uses.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isProduction ? (
              <Button
                variant="outline"
                size="sm"
                onClick={loadDemo}
                disabled={!connected}
              >
                Load demo data
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(token)}
              disabled={!connected || loading}
            >
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Refresh
            </Button>
          </div>
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              Connect
            </CardTitle>
            <CardDescription>
              Paste your token from the extension&rsquo;s options page. It stays
              in this browser&rsquo;s local storage.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="token">Access token</Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="Paste your RavenNow token"
                  autoComplete="off"
                />
              </div>
              <Button onClick={connect} disabled={loading || !token.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Connect
              </Button>
            </div>
            {message ? (
              <p
                className={
                  "mt-3 text-sm " +
                  (error ? "text-destructive" : "text-muted-foreground")
                }
              >
                {message}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Tabs defaultValue="deadlines" className="mt-8">
          <TabsList>
            <TabsTrigger value="deadlines">Deadlines</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
          </TabsList>

          <TabsContent value="deadlines" className="mt-6 space-y-8">
            {!connected ? (
              <p className="text-sm text-muted-foreground">
                Connect with your token to see deadlines.
              </p>
            ) : deadlines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No deadlines yet. Run a sync from the extension, or load demo data
                above.
              </p>
            ) : (
              groupByWeek(deadlines).map((group) => (
                <section key={group.key} className="space-y-3">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </h2>
                  <div className="space-y-2">
                    {group.items.map((deadline) => (
                      <Card key={deadline.id}>
                        <CardContent className="flex items-start gap-4 py-4">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4"
                            checked={deadline.checked}
                            onChange={(event) =>
                              toggle(deadline, event.target.checked)
                            }
                            aria-label={`Mark ${deadline.title} as done`}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={
                                "font-medium " +
                                (deadline.changed
                                  ? "line-through decoration-brand decoration-2"
                                  : "")
                              }
                            >
                              {deadline.title}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {deadline.course_name ||
                                deadline.course_code ||
                                deadline.source}
                            </p>
                            {deadline.changed && deadline.previous_due_at ? (
                              <p className="text-sm text-emerald-600">
                                was{" "}
                                {formatDateTime(deadline.previous_due_at, false)} →
                                now {formatDateTime(deadline.due_at)}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <Badge variant="outline" className="font-normal capitalize">
                              {deadline.type}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTime(deadline.due_at)}
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </section>
              ))
            )}
          </TabsContent>

          <TabsContent value="changes" className="mt-6">
            {changes.filter((c) => c.kind !== "added").length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No changes detected yet.
              </p>
            ) : (
              <div className="space-y-2">
                {changes
                  .filter((c) => c.kind !== "added")
                  .map((change, index) => (
                    <Card key={`${change.uid}-${index}`}>
                      <CardContent className="py-4">
                        <Badge variant="secondary" className="font-normal">
                          {KIND_LABEL[change.kind] ?? change.kind}
                        </Badge>
                        <p className="mt-2 font-medium">{change.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {change.kind === "due_changed" && change.new_due
                            ? `now ${formatDateTime(change.new_due)}. Detected ${formatDateTime(change.detected_at)}`
                            : formatDateTime(change.detected_at)}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {meta ? <SiteFooter meta={meta} /> : null}
    </div>
  );
}
