import { ProjectsPage } from "@/components/projects-page";
import { getProjects } from "@/lib/projects-list";
import { getWebSession } from "@/lib/web-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Page() {
  const session = await getWebSession(await headers());
  if (!session) {
    redirect("/login");
  }

  const initialProjects = await getProjects(session.user.id);

  return <ProjectsPage initialProjects={initialProjects} />;
}
