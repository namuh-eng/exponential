import { IssueDetailView } from "@/components/issue-detail-view";

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <IssueDetailView issueId={id} />;
}
