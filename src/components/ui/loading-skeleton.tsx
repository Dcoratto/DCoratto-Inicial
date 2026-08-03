export function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-1/3 animate-pulse rounded bg-decorato-line" />
      <div className="h-24 animate-pulse rounded-lg bg-white" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-28 animate-pulse rounded-lg bg-white" />
        <div className="h-28 animate-pulse rounded-lg bg-white" />
        <div className="h-28 animate-pulse rounded-lg bg-white" />
      </div>
    </div>
  );
}
