export default function Home() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <h1 className="font-semibold text-2xl tracking-tight">Superfact</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        Evidence-first fact knowledge layer. Upload PDFs to extract atomic assertions bound to their
        source regions, then see what corroborates, contradicts, or reconciles through context.
      </p>
      <p className="mt-8 text-muted-foreground text-sm">
        Upload and inspection workspace not built yet — see{" "}
        <code className="rounded bg-muted px-1 py-0.5">docs/implementation-plan.html</code>.
      </p>
    </div>
  );
}
