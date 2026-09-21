"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  requestStudyPackGenerationAction,
  getStudyPackAction,
} from "@/modules/study-packs/actions";
import type {
  StudyPackView,
  StudyPackItemView,
} from "@/modules/study-packs/types";
import type { DocumentWithSubject } from "@/modules/documents/types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RotateCcw,
  Sparkles,
  ArrowLeft,
  Target,
  FileCheck,
  Zap,
  Bookmark,
  ShieldCheck,
  Layers,
} from "lucide-react";

interface StudyPackViewProps {
  document: DocumentWithSubject;
  initialStudyPack: StudyPackView | null;
}

export function StudyPackViewComponent({
  document,
  initialStudyPack,
}: StudyPackViewProps) {
  const router = useRouter();
  const [studyPack, setStudyPack] = useState<StudyPackView | null>(
    initialStudyPack
  );
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isDocReady =
    document.status === "READY" &&
    document.processing_run?.status === "SUCCEEDED";

  const handleGenerate = () => {
    setFeedback(null);
    startTransition(async () => {
      try {
        const res = await requestStudyPackGenerationAction(document.id);
        if (!res.success) {
          setFeedback({
            type: "error",
            text:
              res.error || "No se pudo solicitar la generación del Study Pack.",
          });
          return;
        }

        setFeedback({
          type: "success",
          text: "Generación encolada correctamente. Procesando en segundo plano...",
        });

        // Fetch latest state
        const updatedRes = await getStudyPackAction(document.id);
        if (updatedRes.success && updatedRes.data) {
          setStudyPack(updatedRes.data);
        } else {
          // Placeholder state if not immediately available
          setStudyPack({
            id: res.data?.studyPackId || "pending",
            documentId: document.id,
            status: "PENDING",
            errorCode: null,
            chunkingVersion: "chunk-v1",
            generationVersion: "sp-gen-v1",
            promptVersion: "sp-prompt-v1",
            sourcePageCount: document.processing_run?.page_count || 0,
            evidencePageCount: 0,
            sourceChunkCount: 0,
            evidenceChunkCount: 0,
            evidenceCharCount: 0,
            items: [],
            createdAt: new Date().toISOString(),
          });
        }
      } catch {
        setFeedback({
          type: "error",
          text: "Error inesperado al solicitar el Study Pack.",
        });
      }
    });
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const res = await getStudyPackAction(document.id);
      if (res.success && res.data) {
        setStudyPack(res.data);
      }
      router.refresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Group items by type safely
  const items = studyPack?.items || [];
  const summaries = items.filter((i) => i.itemType === "SUMMARY");
  const objectives = items.filter((i) => i.itemType === "LEARNING_OBJECTIVE");
  const keyConcepts = items.filter((i) => i.itemType === "KEY_CONCEPT");
  const highYieldPoints = items.filter(
    (i) => i.itemType === "HIGH_YIELD_POINT"
  );
  const keyTerms = items.filter((i) => i.itemType === "KEY_TERM");

  const renderCitations = (citations: StudyPackItemView["citations"]) => {
    if (!citations || citations.length === 0) return null;
    const uniquePages = Array.from(
      new Set(citations.map((c) => c.pageNumber))
    ).sort((a, b) => a - b);
    return (
      <span className="inline-flex items-center gap-1 ml-2 flex-wrap">
        {uniquePages.map((page) => (
          <Badge
            key={page}
            variant="outline"
            className="text-[10px] px-1.5 py-0 font-medium bg-primary/5 text-primary border-primary/20 hover:bg-primary/10 transition-colors cursor-default"
            title={`Afirmación respaldada por la fuente original en la página ${page}`}
          >
            Pág. {page}
          </Badge>
        ))}
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Top Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <Link href="/app/documents">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              Documentos
            </Button>
          </Link>
          <div className="h-4 w-px bg-border/60" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              Study Pack
            </h1>
            <p className="text-xs text-muted-foreground truncate max-w-md">
              {document.original_filename}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {studyPack && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="gap-1.5 text-xs h-8"
            >
              <RotateCcw
                className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
              Actualizar
            </Button>
          )}

          {!studyPack && isDocReady && (
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={isPending}
              className="gap-1.5 text-xs h-8"
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              Generar Study Pack
            </Button>
          )}
        </div>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={`flex items-start gap-2 p-3 text-sm rounded-md border ${
            feedback.type === "error"
              ? "text-destructive bg-destructive/10 border-destructive/20"
              : "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
          }`}
        >
          {feedback.type === "error" ? (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* State 1: Document Not Ready */}
      {!isDocReady && (
        <Card className="border-border bg-card/60">
          <CardContent className="p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">
                Documento pendiente de procesamiento
              </h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Para generar un Study Pack con citas verificadas, el documento
                debe haber completado su extracción de texto y procesamiento
                previo con éxito.
              </p>
            </div>
            <Link href="/app/documents">
              <Button size="sm" variant="outline" className="mt-2">
                Ir a Biblioteca de Documentos
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* State 2: No Study Pack Yet (Ready to Generate) */}
      {isDocReady && !studyPack && (
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="text-center pb-2">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2">
              <Sparkles className="w-6 h-6" />
            </div>
            <CardTitle className="text-lg">
              Generar Study Pack de Alto Rendimiento
            </CardTitle>
            <CardDescription className="max-w-lg mx-auto">
              Sintetiza este documento en un paquete de estudio estructurado con
              resumen analítico, objetivos, conceptos clave y glosario.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
              <div className="p-4 rounded-lg border border-border/50 bg-background/50 space-y-1.5">
                <div className="flex items-center gap-2 text-primary font-semibold text-xs">
                  <ShieldCheck className="w-4 h-4" />
                  Verificación de Evidencia
                </div>
                <p className="text-xs text-muted-foreground">
                  Citas validadas contra el documento fuente con verificación
                  automatizada de evidencia.
                </p>
              </div>

              <div className="p-4 rounded-lg border border-border/50 bg-background/50 space-y-1.5">
                <div className="flex items-center gap-2 text-primary font-semibold text-xs">
                  <FileCheck className="w-4 h-4" />
                  Citas por Página
                </div>
                <p className="text-xs text-muted-foreground">
                  Badges interactivos con la página exacta del documento para
                  contrastar inmediatamente tus fuentes.
                </p>
              </div>

              <div className="p-4 rounded-lg border border-border/50 bg-background/50 space-y-1.5">
                <div className="flex items-center gap-2 text-primary font-semibold text-xs">
                  <Zap className="w-4 h-4" />
                  Puntos de Alto Rendimiento
                </div>
                <p className="text-xs text-muted-foreground">
                  Diferenciales clínicos, asociaciones clave y conceptos
                  destacados en el material como puntos clave para repasar este
                  documento.
                </p>
              </div>
            </div>

            <div className="flex justify-center pt-2">
              <Button
                onClick={handleGenerate}
                disabled={isPending}
                size="lg"
                className="gap-2 px-8"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Solicitando Generación...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Comenzar Generación Manual
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* State 3: In Progress (PENDING / GENERATING) */}
      {studyPack &&
        (studyPack.status === "PENDING" ||
          studyPack.status === "GENERATING") && (
          <Card className="border-border bg-card shadow-xs">
            <CardContent className="p-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-foreground">
                  {studyPack.status === "PENDING"
                    ? "En cola de generación..."
                    : "Sintetizando y verificando evidencia..."}
                </h3>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Fragmentando el material de forma determinista, generando el
                  Study Pack y ejecutando verificación automática de
                  evidencia...
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="gap-1.5 text-xs"
              >
                <RotateCcw
                  className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
                />
                Verificar estado
              </Button>
            </CardContent>
          </Card>
        )}

      {/* State 4: Error State (FAILED_RETRYABLE / FAILED_FINAL) */}
      {studyPack &&
        (studyPack.status === "FAILED_RETRYABLE" ||
          studyPack.status === "FAILED_FINAL") && (
          <Card className="border-destructive/30 bg-destructive/5 shadow-xs">
            <CardContent className="p-8 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-foreground">
                  {studyPack.status === "FAILED_RETRYABLE"
                    ? "Error recuperable en la generación"
                    : "No se pudo generar el Study Pack"}
                </h3>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Código de error:{" "}
                  <code className="bg-muted px-1.5 py-0.5 rounded text-foreground font-mono">
                    {studyPack.errorCode || "DESCONOCIDO"}
                  </code>
                </p>
                {studyPack.errorCode === "STUDY_PACK_EVIDENCE_QA_FAILED" && (
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    La verificación automatizada de evidencia descartó el
                    paquete porque la proporción de afirmaciones respaldadas en
                    el texto fuente no alcanzó el umbral mínimo de seguridad.
                  </p>
                )}
              </div>

              {studyPack.status === "FAILED_RETRYABLE" && (
                <Button
                  onClick={handleGenerate}
                  disabled={isPending}
                  size="sm"
                  className="gap-1.5 text-xs"
                >
                  {isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5" />
                  )}
                  Reintentar Generación
                </Button>
              )}
            </CardContent>
          </Card>
        )}

      {/* State 5: READY — Full Study Pack Display */}
      {studyPack && studyPack.status === "READY" && (
        <div className="space-y-6">
          {/* Educational Clinical Disclosure Banner */}
          <div className="flex items-center gap-2.5 p-3.5 text-xs rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Aviso Académico:</strong> Material generado como
              asistencia de estudio. Siempre verifique con las fuentes primarias
              y criterios clínicos.
            </span>
          </div>

          {/* Metadata & Coverage Disclosure Panel */}
          <Card className="border-border/60 bg-card/40 shadow-xs">
            <CardContent className="p-4 sm:p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4 mb-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-foreground">
                      Respaldo y Cobertura Evidencial
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[11px] gap-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    >
                      <ShieldCheck className="w-3 h-3" />
                      Evidencia Verificada
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Citas validadas contra el documento fuente con verificación
                    automatizada de evidencia.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {studyPack.generationVersion}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {studyPack.chunkingVersion}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">
                    Páginas con evidencia textual
                  </span>
                  <p className="font-semibold text-foreground">
                    {studyPack.evidencePageCount} de {studyPack.sourcePageCount}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">
                    Fragmentos evaluados
                  </span>
                  <p className="font-semibold text-foreground">
                    {studyPack.evidenceChunkCount} de{" "}
                    {studyPack.sourceChunkCount}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">
                    Caracteres de evidencia
                  </span>
                  <p className="font-semibold text-foreground">
                    {studyPack.evidenceCharCount.toLocaleString()}
                  </p>
                </div>
                <div className="space-y-0.5">
                  <span className="text-muted-foreground">
                    Total de elementos
                  </span>
                  <p className="font-semibold text-foreground">
                    {studyPack.items.length} sintetizados
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 1: Resumen */}
          {summaries.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-primary" />
                Resumen General
              </h2>
              <Card className="border-border bg-card shadow-xs">
                <CardContent className="p-5 space-y-3">
                  {summaries.map((item) => {
                    const text =
                      typeof item.payload?.paragraph === "string"
                        ? item.payload.paragraph
                        : "";
                    return (
                      <p
                        key={item.id}
                        className="text-sm leading-relaxed text-foreground/90"
                      >
                        {text}
                        {renderCitations(item.citations)}
                      </p>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Section 2: Objetivos de Aprendizaje */}
          {objectives.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Objetivos de Aprendizaje
              </h2>
              <Card className="border-border bg-card shadow-xs">
                <CardContent className="p-5">
                  <ul className="space-y-2.5">
                    {objectives.map((item) => {
                      const text =
                        typeof item.payload?.objective === "string"
                          ? item.payload.objective
                          : "";
                      return (
                        <li
                          key={item.id}
                          className="text-sm text-foreground/90 flex items-start gap-2.5"
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                          <div>
                            <span>{text}</span>
                            {renderCitations(item.citations)}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Section 3: Conceptos Clave */}
          {keyConcepts.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                Conceptos Clave
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {keyConcepts.map((item) => {
                  const title =
                    typeof item.payload?.title === "string"
                      ? item.payload.title
                      : "";
                  const explanation =
                    typeof item.payload?.explanation === "string"
                      ? item.payload.explanation
                      : "";
                  return (
                    <Card
                      key={item.id}
                      className="border-border bg-card shadow-xs hover:border-border/80 transition-colors"
                    >
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-foreground flex items-start justify-between gap-2">
                          <span>{title}</span>
                          {renderCitations(item.citations)}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {explanation}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 4: Puntos de Alto Rendimiento */}
          {highYieldPoints.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                Puntos de Alto Rendimiento (High-Yield)
              </h2>
              <Card className="border-amber-500/20 bg-amber-500/[0.03] shadow-xs">
                <CardContent className="p-5">
                  <div className="space-y-3">
                    {highYieldPoints.map((item) => {
                      const point =
                        typeof item.payload?.point === "string"
                          ? item.payload.point
                          : "";
                      return (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 p-3 rounded-md bg-background/60 border border-amber-500/10"
                        >
                          <Zap className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          <div className="text-sm text-foreground/90 leading-relaxed">
                            <span>{point}</span>
                            {renderCitations(item.citations)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Section 5: Términos Clave */}
          {keyTerms.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-base font-bold tracking-tight text-foreground flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-primary" />
                Glosario de Términos Clave
              </h2>
              <Card className="border-border bg-card shadow-xs">
                <CardContent className="p-5">
                  <dl className="divide-y divide-border/40">
                    {keyTerms.map((item) => {
                      const term =
                        typeof item.payload?.term === "string"
                          ? item.payload.term
                          : "";
                      const definition =
                        typeof item.payload?.definition === "string"
                          ? item.payload.definition
                          : "";
                      return (
                        <div
                          key={item.id}
                          className="py-3 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4"
                        >
                          <dt className="text-sm font-semibold text-foreground sm:w-1/3 shrink-0 flex items-center justify-between">
                            <span>{term}</span>
                            <span className="sm:hidden">
                              {renderCitations(item.citations)}
                            </span>
                          </dt>
                          <dd className="text-xs text-muted-foreground leading-relaxed sm:w-2/3 flex items-start justify-between gap-2">
                            <span>{definition}</span>
                            <span className="hidden sm:inline">
                              {renderCitations(item.citations)}
                            </span>
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
