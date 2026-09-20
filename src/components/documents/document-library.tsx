"use client";

import { useState, useTransition } from "react";
import {
  getAuthorizedDocumentUrlAction,
  archiveDocumentAction,
} from "@/modules/documents/actions";
import type {
  DocumentWithSubject,
  DocumentQuotaUsage,
} from "@/modules/documents/types";
import type { Subject } from "@/modules/curriculum/types";
import { DocumentUploader } from "./document-uploader";
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
  FileText,
  Upload,
  Trash2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  HardDrive,
  Files,
  ExternalLink,
} from "lucide-react";

interface DocumentLibraryProps {
  initialDocuments: DocumentWithSubject[];
  subjects: Subject[];
  quotaUsage: DocumentQuotaUsage;
}

export function DocumentLibrary({
  initialDocuments,
  subjects,
  quotaUsage,
}: DocumentLibraryProps) {
  const [documents, setDocuments] =
    useState<DocumentWithSubject[]>(initialDocuments);
  const [quotas, setQuotas] = useState<DocumentQuotaUsage>(quotaUsage);
  const [isUploaderOpen, setIsUploaderOpen] = useState(false);
  const [subjectFilter, setSubjectFilter] = useState<string>("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleDownload = async (doc: DocumentWithSubject) => {
    setFeedback(null);
    setDownloadingId(doc.id);

    try {
      const res = await getAuthorizedDocumentUrlAction(doc.id);
      if (!res.success || !res.data?.signedUrl) {
        setFeedback({
          type: "error",
          text: res.error || "No se pudo generar el enlace de acceso seguro.",
        });
        return;
      }

      // Open short-lived signed URL in a new window/tab
      window.open(res.data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setFeedback({
        type: "error",
        text: "Error inesperado al solicitar el documento.",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleArchive = (doc: DocumentWithSubject) => {
    if (
      !confirm(
        `¿Estás seguro de archivar "${doc.original_filename}"? Se removerá de tu biblioteca activa.`
      )
    ) {
      return;
    }

    setFeedback(null);
    startTransition(async () => {
      const res = await archiveDocumentAction(doc.id);
      if (!res.success) {
        setFeedback({
          type: "error",
          text: res.error || "No se pudo archivar el documento.",
        });
        return;
      }

      // Remove from local list and update quota state
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setQuotas((prev) => ({
        ...prev,
        activeDocumentsCount: Math.max(0, prev.activeDocumentsCount - 1),
        totalSizeBytes: Math.max(0, prev.totalSizeBytes - doc.size_bytes),
      }));

      setFeedback({
        type: "success",
        text: `Documento "${doc.original_filename}" archivado correctamente.`,
      });
    });
  };

  const handleUploadSuccess = () => {
    setIsUploaderOpen(false);
    setFeedback({
      type: "success",
      text: "Documento subido y validado exitosamente. Actualizando biblioteca...",
    });
    // Trigger page refresh to reload server-side documents and quota
    window.location.reload();
  };

  const filteredDocuments = documents.filter((doc) => {
    if (!subjectFilter) return true;
    return doc.subject_id === subjectFilter;
  });

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("es-PE", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return isoString;
    }
  };

  const getStatusBadge = (status: string, errorCode?: string | null) => {
    switch (status) {
      case "READY":
        return (
          <Badge
            variant="default"
            className="bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs"
          >
            Listo
          </Badge>
        );
      case "VALIDATING":
        return (
          <Badge
            variant="secondary"
            className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-xs"
          >
            Validando
          </Badge>
        );
      case "UPLOADING":
        return (
          <Badge
            variant="secondary"
            className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-xs"
          >
            Subiendo
          </Badge>
        );
      case "REJECTED":
        return (
          <Badge
            variant="destructive"
            className="text-xs"
            title={errorCode || "Archivo rechazado"}
          >
            Rechazado
          </Badge>
        );
      case "FAILED":
      default:
        return (
          <Badge variant="destructive" className="text-xs">
            Fallido
          </Badge>
        );
    }
  };

  const storagePercentage = Math.min(
    100,
    Math.round((quotas.totalSizeBytes / quotas.maxTotalBytes) * 100)
  );

  return (
    <div className="space-y-6">
      {/* Header with Title and Upload CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Biblioteca de Documentos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Almacenamiento privado y seguro para tus diapositivas y lecturas
            médicas.
          </p>
        </div>

        <Button
          onClick={() => setIsUploaderOpen((prev) => !prev)}
          className="gap-2 shrink-0"
        >
          <Upload className="w-4 h-4" />
          {isUploaderOpen ? "Cerrar Subida" : "Subir PDF"}
        </Button>
      </div>

      {/* Feedback Alerts */}
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

      {/* Quotas & Capacity Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="border-border bg-card/40 shadow-xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Files className="w-3.5 h-3.5 text-primary" />
                Documentos Activos
              </span>
              <p className="text-2xl font-bold text-foreground">
                {quotas.activeDocumentsCount}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  / {quotas.maxActiveDocuments} permitidos
                </span>
              </p>
            </div>
            <Badge
              variant={
                quotas.activeDocumentsCount >= quotas.maxActiveDocuments
                  ? "destructive"
                  : "outline"
              }
            >
              {quotas.maxActiveDocuments - quotas.activeDocumentsCount}{" "}
              disponibles
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-border bg-card/40 shadow-xs">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-primary" />
                Almacenamiento Usado
              </span>
              <span className="text-xs text-muted-foreground">
                {formatFileSize(quotas.totalSizeBytes)} /{" "}
                {formatFileSize(quotas.maxTotalBytes)}
              </span>
            </div>
            <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  storagePercentage > 90
                    ? "bg-destructive"
                    : storagePercentage > 75
                      ? "bg-amber-500"
                      : "bg-primary"
                }`}
                style={{ width: `${storagePercentage}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Uploader Section (Collapsible) */}
      {isUploaderOpen && (
        <Card className="border-primary/40 bg-card shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              Subir Nuevo Documento PDF
            </CardTitle>
            <CardDescription>
              El archivo se almacenará de manera privada y cifrada. Solo tú
              tendrás acceso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentUploader
              subjects={subjects}
              onUploadSuccess={handleUploadSuccess}
              onCancel={() => setIsUploaderOpen(false)}
            />
          </CardContent>
        </Card>
      )}

      {/* Filter and Documents List */}
      <Card className="border-border bg-card shadow-xs">
        <CardHeader className="border-b border-border/40 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base">Documentos Subidos</CardTitle>
              <CardDescription>
                {filteredDocuments.length}{" "}
                {filteredDocuments.length === 1 ? "documento" : "documentos"}{" "}
                encontrados
              </CardDescription>
            </div>

            {subjects.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">
                  Filtrar:
                </span>
                <select
                  value={subjectFilter}
                  onChange={(e) => setSubjectFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Todas las asignaturas</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0 divide-y divide-border/40">
          {filteredDocuments.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground mx-auto">
                <FileText className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">
                  No hay documentos en esta lista
                </p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Sube tus primeras diapositivas o apuntes en PDF para activar
                  tu biblioteca de estudio.
                </p>
              </div>
              {!isUploaderOpen && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsUploaderOpen(true)}
                  className="mt-2 gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Subir mi primer documento
                </Button>
              )}
            </div>
          ) : (
            filteredDocuments.map((doc) => {
              const isReady = doc.status === "READY";
              const isDownloading = downloadingId === doc.id;

              return (
                <div
                  key={doc.id}
                  className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5">
                      <FileText className="w-5 h-5" />
                    </div>

                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Filename rendered safely as text */}
                        <p
                          className="text-sm font-semibold text-foreground truncate max-w-xs sm:max-w-md"
                          title={doc.original_filename}
                        >
                          {doc.original_filename}
                        </p>
                        {getStatusBadge(doc.status, doc.validation_error_code)}
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span>{formatFileSize(doc.size_bytes)}</span>
                        <span>•</span>
                        <span>{formatDate(doc.created_at)}</span>
                        {doc.subject && (
                          <>
                            <span>•</span>
                            <Badge
                              variant="outline"
                              className="text-[11px] py-0 px-1.5 font-normal text-muted-foreground"
                            >
                              {doc.subject.name}
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {isReady && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(doc)}
                        disabled={isDownloading}
                        className="gap-1.5 text-xs h-8"
                      >
                        {isDownloading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ExternalLink className="w-3.5 h-3.5" />
                        )}
                        Ver / Descargar
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleArchive(doc)}
                      disabled={isPending}
                      className="text-muted-foreground hover:text-destructive h-8 px-2"
                      title="Archivar documento"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span className="sr-only">Archivar</span>
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
