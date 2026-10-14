import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-7 w-7 place-items-center rounded-lg bg-brand text-[11px] font-bold text-brand-foreground",
        className
      )}
    >
      RS
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <BrandMark />
      Raven Scheduling
    </span>
  );
}
