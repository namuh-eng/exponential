import { AuthPage } from "@/components/auth-page";

export const dynamic = "force-static";

export default function SignupPage() {
  return <AuthPage mode="signup" />;
}
