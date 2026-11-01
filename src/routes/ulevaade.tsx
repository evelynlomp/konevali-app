import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/ulevaade")({
  head: () => ({
    meta: [
      { title: "Kokkuvõte – Kõneväli" },
      { name: "description", content: "Kokkuvõtet selles versioonis ei ole." },
    ],
  }),
  component: InsightsPage,
});

/** The earlier page showed a made-up summary, tasks and "mood" as if the AI had made them from the conversation. */
function InsightsPage() {
  return (
    <p className="rounded-md border-2 border-dashed border-border p-8 text-center text-lg text-muted-foreground">
      Kokkuvõtet selles versioonis ei ole.
    </p>
  );
}
