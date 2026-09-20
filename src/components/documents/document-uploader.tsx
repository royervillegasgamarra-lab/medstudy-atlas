"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/browser";
import {
  requestDocumentUploadAction,
  finalizeDocumentUploadAction,
} from "@/modules/documents/actions";
import { UPLOAD_LIMITS } from "@/config/app";
import type { Subject } from "@/modules/curriculum/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ShieldAlert,
} from "lucide-react";

interface DocumentUploaderProps {
  subjects: Subject[];
  onUploadSuccess?: () => void;
  onCancel?: () => void;
}

type UploadStep =
  "IDLE" | "AUTHORIZING" | "UPLOADING_STORAGE" | "VALIDATING" | "SUCCESS";

export function DocumentUploader({
  subjects,
  onUploadSuccess,
  onCancel,
}: DocumentUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [subjectId, setSubjectId] = useState<string>("");
  const [step, setStep] = useState<UploadStep>("IDLE");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (selectedFile: File | null) => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedFile) {
      setFile(null);
      return;
    }

    // Client-side pre-validation
    if (!selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setErrorMsg("Solo se permiten archivos con extensión .pdf.");
      setFile(null);
      return;
    }

    if (selectedFile.size > UPLOAD_LIMITS.maxFileSizeBytes) {
      setErrorMsg(
        `El archivo excede el tamaño máximo permitido de ${
          UPLOAD_LIMITS.maxFileSizeBytes / (1024 * 1024)
        } MB.`
      );
      setFile(null);
      return;
    }

    if (selectedFile.size === 0) {
      setErrorMsg("El archivo seleccionado está vacío.");
      setFile(null);
      return;
    }

    setFile(selectedFile);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setErrorMsg("Por favor selecciona un archivo PDF.");
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // Step 1: Request upload reservation & exact signed upload token
      setStep("AUTHORIZING");
      const authRes = await requestDocumentUploadAction({
        original_filename: file.name,
        size_bytes: file.size,
        mime_type: file.type || "application/pdf",
        subject_id: subjectId || null,
      });

      if (!authRes.success || !authRes.data) {
        setErrorMsg(authRes.error || "No se pudo autorizar la subida.");
        setStep("IDLE");
        return;
      }

      const { documentId, storageBucket, storageKey, signedUploadToken } =
        authRes.data;

      // Step 2: Upload to exact signed upload URL (upsert: false)
      setStep("UPLOADING_STORAGE");
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(storageBucket)
        .uploadToSignedUrl(storageKey, signedUploadToken, file, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        setErrorMsg(
          "Error al transferir el archivo al almacenamiento privado: " +
            uploadError.message
        );
        setStep("IDLE");
        return;
      }

      // Step 3: Server-side container validation (magic bytes & size)
      setStep("VALIDATING");
      const finalizeRes = await finalizeDocumentUploadAction(documentId);

      if (!finalizeRes.success) {
        setErrorMsg(
          finalizeRes.error ||
            "El archivo fue rechazado durante la validación de cabecera."
        );
        setStep("IDLE");
        return;
      }

      // Step 4: Success
      setStep("SUCCESS");
      setSuccessMsg("¡Documento subido y validado con éxito!");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      if (onUploadSuccess) {
        setTimeout(() => {
          onUploadSuccess();
        }, 800);
      }
    } catch {
      setErrorMsg("Error inesperado durante el proceso de subida.");
      setStep("IDLE");
    }
  };

  const isUploading = step !== "IDLE" && step !== "SUCCESS";

  return (
    <div className="space-y-4">
      {/* P1-6: Concise educational-use PHI warning banner */}
      <div className="flex items-start gap-2.5 p-3 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 rounded-md">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div>
          <span className="font-semibold">Uso exclusivamente educativo:</span>{" "}
          Queda estrictamente prohibido subir historias clínicas, registros
          médicos de pacientes o cualquier dato de salud protegido (PHI / datos
          personales identificables).
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 p-3 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="flex items-start gap-2 p-3 text-sm text-primary bg-primary/10 border border-primary/20 rounded-md">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      <form onSubmit={handleUpload} className="space-y-4">
        {/* Dropzone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !isUploading && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 bg-card/40"
          } ${isUploading ? "opacity-60 pointer-events-none" : ""}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) =>
              handleFileChange(e.target.files ? e.target.files[0] : null)
            }
            disabled={isUploading}
          />

          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
              {file ? (
                <FileText className="w-6 h-6" />
              ) : (
                <Upload className="w-6 h-6" />
              )}
            </div>

            {file ? (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground max-w-xs sm:max-w-md truncate">
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
                <Badge
                  variant="outline"
                  className="text-xs text-primary border-primary/40"
                >
                  Listo para subir
                </Badge>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Haz clic para seleccionar o arrastra un archivo PDF aquí
                </p>
                <p className="text-xs text-muted-foreground">
                  Máximo 25 MB por documento • Formato PDF
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Subject Assignment (Optional) */}
        {subjects.length > 0 && (
          <div className="space-y-1">
            <Label
              htmlFor="upload-subject"
              className="text-xs text-muted-foreground"
            >
              Asignatura (opcional)
            </Label>
            <select
              id="upload-subject"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={isUploading}
              className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-foreground"
            >
              <option value="">Sin asignatura asignada</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Progress status indicators */}
        {isUploading && (
          <div className="space-y-2 p-3 bg-muted/40 rounded-md border border-border/60">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span>
                {step === "AUTHORIZING" &&
                  "1/3 Solicitando autorización segura..."}
                {step === "UPLOADING_STORAGE" &&
                  "2/3 Subiendo al almacenamiento privado..."}
                {step === "VALIDATING" &&
                  "3/3 Validando firma y cabecera PDF..."}
              </span>
            </div>
            <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300 rounded-full"
                style={{
                  width:
                    step === "AUTHORIZING"
                      ? "30%"
                      : step === "UPLOADING_STORAGE"
                        ? "70%"
                        : step === "VALIDATING"
                          ? "90%"
                          : "100%",
                }}
              />
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isUploading}
            >
              Cancelar
            </Button>
          )}

          <Button
            type="submit"
            size="sm"
            disabled={!file || isUploading}
            className="gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Subiendo...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Subir Documento
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
