import { AuthPage } from "@/components/auth-page";

export const dynamic = "force-dynamic";

export default function SignupPage() {
  return <AuthPage mode="signup" />;
}
