import { IssueDetailView } from "@/components/issue-detail-view";

export default async function TeamIssueDetailPage({
  params,
}: {
  params: Promise<{ key: string; id: string }>;
}) {
  const { id } = await params;

  return <IssueDetailView issueId={id} />;
}
