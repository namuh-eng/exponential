import "@testing-library/jest-dom/vitest";
import PricingPage from "@/app/pricing/page";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("Pricing enterprise packaging", () => {
  it("shows Enterprise Cloud and Enterprise Self-hosted contact flows without private contact details", () => {
    render(<PricingPage />);

    expect(screen.getByText("Enterprise Cloud")).toBeInTheDocument();
    expect(screen.getByText("Enterprise Self-hosted")).toBeInTheDocument();
    expect(screen.getByText("Self-host support boundary")).toBeInTheDocument();
    expect(screen.getByText(/Community Self-hosted/)).toBeInTheDocument();

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
