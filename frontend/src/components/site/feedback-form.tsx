import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitFeedback } from "@/lib/meta";

type Status = "idle" | "sending" | "sent" | "error";

export function FeedbackForm() {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim() || status === "sending") return;
    setStatus("sending");
    try {
      await submitFeedback({ message, email });
      setStatus("sent");
      setMessage("");
      setEmail("");
    } catch {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="feedback-message">Your feedback or request</Label>
        <Textarea
          id="feedback-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="e.g. Please add support for my program's site, or a dark mode."
          required
          className="min-h-[120px]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="feedback-email">
          Email <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="feedback-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@cmail.carleton.ca"
          autoComplete="email"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={status === "sending"}>
          {status === "sending" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : null}
          Send
        </Button>
        {status === "sent" ? (
          <span className="text-sm text-emerald-600">
            Thanks — we got your message.
          </span>
        ) : null}
        {status === "error" ? (
          <span className="text-sm text-destructive">
            Something went wrong. Please try again.
          </span>
        ) : null}
      </div>
    </form>
  );
}
