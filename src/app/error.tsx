"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
        <AlertCircle className="size-6" />
      </div>
      <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        Something went wrong
      </h2>
      <p className="mt-2 text-sm text-muted-foreground max-w-md">
        An unexpected error occurred. Please try again or contact support if the
        issue persists.
      </p>
      <Button onClick={() => reset()} variant="default" className="mt-6">
        Try again
      </Button>
    </div>
  );
}
