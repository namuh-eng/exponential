"use client";

import { InsightsPanel } from "@/components/insights-panel";
import { useParams } from "next/navigation";

export default function TeamAnalyticsPage() {
  const params = useParams<{ key: string }>();
  return <InsightsPanel teamKey={params.key} mode="page" />;
}
