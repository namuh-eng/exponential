import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SshChallengePage from "@/app/(auth)/ssh-challenge/page";

describe("SSH challenge preview", () => {
  afterEach(() => {
    cleanup();
  });

  it("labels the challenge as a sample and keeps the verifier disabled", () => {
    render(<SshChallengePage />);

    expect(screen.getByText("mock · sample challenge")).toBeDefined();
    expect(screen.getByText(/no backend verifier/)).toBeDefined();
    expect(screen.getByText(/sample keys.*registry pending/)).toBeDefined();
    expect(screen.queryByText(/exponential\.local/)).toBeNull();

    const verifyButton = screen.getByRole("button", {
      name: /verification backend pending/i,
    });
    expect(verifyButton).toHaveProperty("disabled", true);
  });

  it("only performs local signature block detection", () => {
    render(<SshChallengePage />);

    fireEvent.change(screen.getByPlaceholderText(/BEGIN SSH SIGNATURE/), {
      target: {
        value:
          "-----BEGIN SSH SIGNATURE-----\nU1NIU0lH\n-----END SSH SIGNATURE-----",
      },
    });

    expect(screen.getByText("signature block detected locally")).toBeDefined();
    expect(
      screen.getByText("local format ok · no session opened"),
    ).toBeDefined();
  });
});
