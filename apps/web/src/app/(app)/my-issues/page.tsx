import { redirect } from "next/navigation";

export default function MyIssuesPage() {
  redirect("/my-issues/assigned");
}
