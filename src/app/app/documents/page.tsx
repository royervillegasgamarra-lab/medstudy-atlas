import { getUserDocuments, getDocumentQuotaUsage } from "@/modules/documents";
import { getActiveSubjects } from "@/modules/curriculum";
import { DocumentLibrary } from "@/components/documents/document-library";
import { UPLOAD_LIMITS } from "@/config/app";

export default async function DocumentsPage() {
  const [docsRes, quotaRes, subjectsRes] = await Promise.all([
    getUserDocuments(),
    getDocumentQuotaUsage(),
    getActiveSubjects(),
  ]);

  const documents = docsRes.data || [];
  const subjects = subjectsRes.data || [];
  const quotaUsage = quotaRes.data || {
    activeDocumentsCount: documents.length,
    maxActiveDocuments: UPLOAD_LIMITS.maxActiveDocumentsPerUser,
    totalSizeBytes: documents.reduce((acc, d) => acc + (d.size_bytes || 0), 0),
    maxTotalBytes: UPLOAD_LIMITS.maxTotalDocumentBytesPerUser,
  };

  return (
    <DocumentLibrary
      initialDocuments={documents}
      subjects={subjects}
      quotaUsage={quotaUsage}
    />
  );
}
