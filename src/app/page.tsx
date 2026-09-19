import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APP_CONFIG } from "@/config/app";
import { cn } from "@/lib/utils";
import {
  Activity,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  FileCode2,
  Lock,
  Sparkles,
} from "lucide-react";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header Navigation */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground font-semibold shadow-sm">
              <Activity className="size-5" />
            </div>
            <div>
              <span className="font-semibold tracking-tight text-foreground">
                {APP_CONFIG.name}
              </span>
              <span className="ml-2 hidden text-xs text-muted-foreground sm:inline-block">
                v{APP_CONFIG.version}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="success" className="gap-1 px-2.5 py-0.5 text-xs">
              <span className="size-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400 animate-pulse" />
              Phase 0C
            </Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Hero & Status Workspace Shell */}
      <main className="container mx-auto flex-1 max-w-5xl px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-3xl text-center space-y-4">
          <Badge
            variant="outline"
            className="mb-2 text-xs uppercase tracking-wider"
          >
            Local-First Verification Baseline
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
            MedStudy Atlas
          </h1>
          <p className="text-lg text-muted-foreground sm:text-xl">
            {APP_CONFIG.tagline}
          </p>
          <p className="text-sm font-medium text-primary">
            Engineering baseline operational — Phase 0C
          </p>
        </div>

        {/* Architecture Status Cards */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Engineering Stack
                </CardTitle>
                <FileCode2 className="size-4 text-muted-foreground" />
              </div>
              <CardDescription>
                Verified local toolchain and build pipelines
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Framework</span>
                <span className="font-mono text-xs font-medium">
                  Next.js 16 (App Router)
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Language</span>
                <span className="font-mono text-xs font-medium">
                  TypeScript Strict
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Styling</span>
                <span className="font-mono text-xs font-medium">
                  Tailwind CSS v4
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="text-muted-foreground">Components</span>
                <span className="font-mono text-xs font-medium">
                  shadcn/ui (Base UI)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Testing</span>
                <span className="font-mono text-xs font-medium">
                  Vitest + Playwright
                </span>
              </div>
            </CardContent>
            <CardFooter className="pt-2">
              <a
                href="/api/health"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "w-full text-xs"
                )}
              >
                Inspect Local Health Endpoint
                <ExternalLink className="ml-1.5 size-3.5" />
              </a>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">
                  Subsystem Posture
                </CardTitle>
                <Cpu className="size-4 text-muted-foreground" />
              </div>
              <CardDescription>
                Zero external cloud dependencies or paid services
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                  Local Runtime
                </span>
                <Badge variant="outline" className="text-xs">
                  OPERATIONAL
                </Badge>
              </div>
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Database className="size-3.5 text-muted-foreground" />
                  Database
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  UNINITIALIZED ($0.00)
                </span>
              </div>
              <div className="flex items-center justify-between border-b border-border/50 pb-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Lock className="size-3.5 text-muted-foreground" />
                  Authentication
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  UNINITIALIZED ($0.00)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Sparkles className="size-3.5 text-muted-foreground" />
                  AI Gateway
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  UNINITIALIZED ($0.00)
                </span>
              </div>
            </CardContent>
            <CardFooter className="pt-2">
              <div className="w-full text-center text-xs text-muted-foreground">
                All cloud systems isolated ($0.00 incurred)
              </div>
            </CardFooter>
          </Card>
        </div>

        {/* Quality Gates Notice */}
        <div className="mt-8 rounded-lg border border-border/60 bg-muted/40 p-4 text-center">
          <p className="text-xs text-muted-foreground">
            Development Mode:{" "}
            <strong className="text-foreground">LOCAL-FIRST</strong> • Branch:{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              phase/00c-engineering
            </code>{" "}
            • Quality Gates: Format, Lint, Typecheck, Unit Tests, Production
            Build
          </p>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="border-t border-border/40 py-6 text-center text-xs text-muted-foreground">
        <p>MedStudy Atlas © 2026 — Local-First Engineering Baseline</p>
      </footer>
    </div>
  );
}
