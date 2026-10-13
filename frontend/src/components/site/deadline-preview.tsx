import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const ROWS = [
  { type: "Assignment", title: "COMP 1405: Assignment 3", when: "Tue 11:59 PM", dot: "bg-brand" },
  { type: "Quiz", title: "MATH 1007: Quiz 2", when: "Fri 12:00 PM", dot: "bg-amber-500" },
  { type: "Lab", title: "PHYS 1003: Lab 4", when: "Sun 5:00 PM", dot: "bg-sky-500" },
];

export function DeadlinePreview() {
  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">This week</CardTitle>
        <Badge variant="secondary" className="font-normal">
          Brightspace
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {ROWS.map((row) => (
          <div key={row.title} className="flex items-center gap-3">
            <span className={`h-2 w-2 shrink-0 rounded-full ${row.dot}`} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.title}</p>
              <p className="text-xs text-muted-foreground">{row.type}</p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">{row.when}</span>
          </div>
        ))}
        <Separator />
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-brand" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium line-through decoration-brand decoration-2">
              COMP 1405: Quiz 2
            </p>
            <p className="text-xs text-emerald-600">Moved to Mon 9:00 AM</p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">changed</span>
        </div>
      </CardContent>
    </Card>
  );
}
