// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sanitizeQuestionHtml } from "@/lib/questions";
import { createEditorExtensions, TiptapEditor } from "./TiptapEditor";

afterEach(() => cleanup());

describe("TiptapEditor", () => {
  it("offers only the approved toolbar controls and applies Sinhala language metadata", async () => {
    render(<TiptapEditor ariaLabel="Question text" maxLength={50_000} value="<p>සිංහල ප්‍රශ්නය</p>" onChange={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Heading 2" })).toBeTruthy();
    expect(screen.getByLabelText("Font size")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /subscript/i })).toBeNull();
    expect(screen.getByRole("toolbar").closest("div")?.parentElement?.getAttribute("lang")).toBe("si");
  });

  it("does not offer headings in an option editor", async () => {
    render(<TiptapEditor ariaLabel="Option A text" headings={false} maxLength={5_000} value="<p>Choice</p>" onChange={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Bold" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Heading 2" })).toBeNull();
  });

  it("cannot create blockquotes, code, code blocks, rules or links by typing or pasted HTML", () => {
    const editor = new Editor({
      extensions: createEditorExtensions(true, 50_000),
      content: '<blockquote>Quote</blockquote><pre><code>block</code></pre><p><code>inline</code> <a href="https://example.test">link</a></p><hr>',
    });
    editor.commands.insertContent('<blockquote>Pasted quote</blockquote><p><code>Pasted code</code> <a href="https://example.test">pasted link</a></p><hr>');
    editor.commands.insertContent("> typed quote `typed code` --- https://example.test");
    const html = editor.getHTML();
    expect(html).not.toMatch(/<(?:blockquote|pre|code|hr|a)\b/i);
    expect(html).toContain("typed quote");
    editor.destroy();
  });

  it("produces HTML that is already equal to the server sanitizer output", () => {
    const editor = new Editor({
      extensions: createEditorExtensions(true, 50_000),
      content: '<h2>Heading</h2><p><strong>Bold</strong> <em>italic</em> <u>underline</u> <s>strike</s> <span style="font-size: 24px">large</span></p><ul><li>One</li></ul><ol><li>Two</li></ol>',
    });
    expect(editor.getHTML()).toBe(sanitizeQuestionHtml(editor.getHTML()));
    editor.destroy();
  });

  it("blocks edits beyond maxLength and announces the limit without displayed/saved divergence", async () => {
    const onChange = vi.fn();
    render(<TiptapEditor ariaLabel="Limited text" maxLength={20} value="<p>Short</p>" onChange={onChange} />);
    const field = await screen.findByLabelText("Limited text");
    fireEvent.input(field, { target: { textContent: "This text is much longer than twenty characters" }, inputType: "insertText", data: "This text is much longer than twenty characters" });
    expect(await screen.findByText(/Maximum 20 characters reached/)).toBeTruthy();
    expect(field.innerHTML).toBe("<p>Short</p>");
    expect(onChange).not.toHaveBeenCalledWith(expect.stringContaining("much longer"));
  });

  it("reflects the selected text's font size and registers underline only once", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<TiptapEditor ariaLabel="Sized text" maxLength={500} value={'<p><span style="font-size: 24px">Large</span></p>'} onChange={vi.fn()} />);
    await waitFor(() => expect((screen.getByLabelText("Font size") as HTMLSelectElement).value).toBe("24px"));
    expect(warnings.mock.calls.flat().join(" ")).not.toContain("Duplicate extension");
    warnings.mockRestore();
  });

  it("marks an API-invalid editor and places its message beside the field", async () => {
    render(<TiptapEditor ariaLabel="Invalid option" error="Option B needs text." maxLength={5_000} value="<p></p>" onChange={vi.fn()} />);
    const editor = await screen.findByLabelText("Invalid option");
    expect(editor.getAttribute("aria-invalid")).toBe("true");
    expect(editor.getAttribute("aria-describedby")).toBe("invalid-option-error");
    expect(screen.getByText("Option B needs text.")).toBeTruthy();
  });
});
