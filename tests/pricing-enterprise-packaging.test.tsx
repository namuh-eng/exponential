import "@testing-library/jest-dom/vitest";
import PricingPage from "@/app/pricing/page";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Pricing enterprise packaging", () => {
  it("shows Enterprise Cloud and Enterprise Self-hosted contact flows without private contact details", () => {
    render(<PricingPage />);

    for (const planName of [
      "Community Self-hosted",
      "Cloud Free",
      "Cloud Team",
      "Cloud Business",
      "Enterprise Cloud",
      "Enterprise Self-hosted",
    ]) {
      expect(screen.getByText(planName)).toBeInTheDocument();
    }

    expect(screen.getByText("$7")).toBeInTheDocument();
    expect(screen.getAllByText("per user/mo, billed annually")).toHaveLength(2);
    expect(screen.getByText("$9/user/mo monthly")).toBeInTheDocument();
    expect(screen.getByText("$12")).toBeInTheDocument();
    expect(screen.getByText("$15/user/mo monthly")).toBeInTheDocument();
    expect(
      screen.getAllByText(
        /core self-host\/community issue tracking remains free/i,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        /paid gates focus on managed cloud, scale, admin, security, compliance, and support/i,
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("Enterprise Cloud")).toBeInTheDocument();
    expect(screen.getByText("Enterprise Self-hosted")).toBeInTheDocument();
    expect(screen.getByText("Self-host support boundary")).toBeInTheDocument();
    expect(screen.getAllByText(/Community Self-hosted/).length).toBeGreaterThan(
      0,
    );

    const contactLinks = screen.getAllByRole("link", { name: "Contact sales" });
    expect(contactLinks[0]).toHaveAttribute(
      "href",
      "/signup?intent=enterprise-cloud",
    );
    expect(contactLinks[1]).toHaveAttribute(
      "href",
      "/signup?intent=enterprise-self-hosted",
    );

    expect(document.body.textContent).not.toMatch(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+/i,
    );
    expect(document.body.textContent).not.toContain("sk_");
  });
});
