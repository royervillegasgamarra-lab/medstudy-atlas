import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/identity";
import { getDocumentById } from "@/modules/documents/service";
import { getStudyPack } from "@/modules/study-packs/service";
import { StudyPackViewComponent } from "@/components/study-packs/study-pack-view";

interface StudyPackPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function DocumentStudyPackPage({
  params,
}: StudyPackPageProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/auth/login");
  }

  const { id: documentId } = await params;

  const [docRes, studyPack] = await Promise.all([
    getDocumentById(documentId),
    getStudyPack(documentId, user.id),
  ]);

  if (!docRes.data) {
    notFound();
  }

  return (
    <StudyPackViewComponent
      document={docRes.data}
      initialStudyPack={studyPack}
    />
  );
}
