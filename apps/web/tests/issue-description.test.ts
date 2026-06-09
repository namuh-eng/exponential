import {
  normalizeIssueDescriptionHtml,
  plainTextToRichTextHtml,
  richTextHtmlToPlainText,
} from "@/lib/issue-description";
import { describe, expect, it } from "vitest";

describe("issue description helpers", () => {
  it("turns plain text into paragraph-based rich text", () => {
    expect(plainTextToRichTextHtml("Hello\nWorld\n\nNext")).toBe(
      "<p>Hello<br />World</p><p>Next</p>",
    );
  });

  it("normalizes plain text descriptions before persistence", () => {
    expect(normalizeIssueDescriptionHtml("  Ship feature  \nsoon  ")).toBe(
      "<p>Ship feature  <br />soon</p>",
    );
  });

  it("removes dangerous script content from rich text", () => {
    expect(
      normalizeIssueDescriptionHtml(
        '<p>Safe</p><script>alert("x")</script><a href="javascript:bad()">link</a>',
      ),
    ).toBe('<p>Safe</p><a href="#">link</a>');
  });

  it("extracts readable text from stored rich text", () => {
    expect(
      richTextHtmlToPlainText(
        "<p>Hello <strong>team</strong></p><ul><li>First</li><li>Second</li></ul>",
      ),
    ).toBe("Hello team\n• First\n• Second");
  });
});
