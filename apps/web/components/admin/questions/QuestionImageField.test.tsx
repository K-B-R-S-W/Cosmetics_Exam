// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestionImageField } from "./QuestionImageField";
import { ToastProvider } from "@/components/ui/Toast";

const fetchMock = vi.fn();
const onChange = vi.fn();
const image = {
  path: "questions/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000105.jpg",
  alt_text: "Synthetic diagram", mime: "image/jpeg" as const, size_bytes: 123, image_missing: true as const,
};

beforeEach(() => {
  fetchMock.mockReset(); onChange.mockReset(); vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:synthetic-preview"), revokeObjectURL: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QuestionImageField", () => {
  it("shows the re-upload state and a local preview before upload", async () => {
    render(<ToastProvider><QuestionImageField image={image} persistedPath={image.path} questionId="00000000-0000-4000-8000-000000000101" onChange={onChange} /></ToastProvider>);
    expect(screen.getByText(/saved image is missing/i)).toBeTruthy();
    const file = new File(["synthetic"], "diagram.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Replace image file"), { target: { files: [file] } });
    expect((await screen.findByAltText("Synthetic diagram") as HTMLImageElement).getAttribute("src")).toBe("blob:synthetic-preview");
  });

  it("uploads alt text and processed metadata, then reports the image", async () => {
    render(<ToastProvider><QuestionImageField image={null} persistedPath={null} questionId="00000000-0000-4000-8000-000000000101" onChange={onChange} /></ToastProvider>);
    fireEvent.click(screen.getByRole("checkbox", { name: "Add image" }));
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "Synthetic chart" } });
    fireEvent.change(screen.getByLabelText("Question image file"), { target: { files: [new File(["x"], "chart.png", { type: "image/png" })] } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ image: { ...image, image_missing: undefined, alt_text: "Synthetic chart" } }), { status: 201 }));
    fireEvent.click(screen.getByRole("button", { name: "Upload image" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ alt_text: "Synthetic chart" })));
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
    expect((screen.getByAltText("Synthetic chart") as HTMLImageElement).getAttribute("src")).toBe("blob:synthetic-preview");
  });

  it("stages removal of a persisted image for the single question save", async () => {
    render(<ToastProvider><QuestionImageField image={{ ...image, image_missing: undefined }} persistedPath={image.path} questionId="00000000-0000-4000-8000-000000000101" onChange={onChange} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps local upload checks inline", async () => {
    render(<ToastProvider><QuestionImageField image={null} persistedPath={null} questionId="00000000-0000-4000-8000-000000000101" onChange={onChange} /></ToastProvider>);
    fireEvent.click(screen.getByRole("checkbox", { name: "Add image" }));
    fireEvent.change(screen.getByLabelText("Question image file"), { target: { files: [new File(["x"], "chart.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload image" }));

    expect(await screen.findByText("Enter alt text before uploading.")).toBeTruthy();
    expect(within(screen.getByTestId("toast-container")).queryByText("Enter alt text before uploading.")).toBeNull();
  });

  it("shows upload request failures as persistent toasts", async () => {
    render(<ToastProvider><QuestionImageField image={null} persistedPath={null} questionId="00000000-0000-4000-8000-000000000101" onChange={onChange} /></ToastProvider>);
    fireEvent.click(screen.getByRole("checkbox", { name: "Add image" }));
    fireEvent.change(screen.getByLabelText("Alt text"), { target: { value: "Synthetic chart" } });
    fireEvent.change(screen.getByLabelText("Question image file"), { target: { files: [new File(["x"], "chart.png", { type: "image/png" })] } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Synthetic upload failure." } }), { status: 500 }));
    fireEvent.click(screen.getByRole("button", { name: "Upload image" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("Synthetic upload failure.")).toBeTruthy();
  });

  it("shows staged-image removal failures as persistent toasts", async () => {
    render(<ToastProvider><QuestionImageField image={{ ...image, image_missing: undefined }} persistedPath={null} questionId="00000000-0000-4000-8000-000000000101" onChange={onChange} /></ToastProvider>);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Synthetic remove failure." } }), { status: 500 }));
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

    expect(await within(screen.getByTestId("toast-container")).findByText("The image could not be removed. Try again.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalledWith(null);
  });
});
