// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateList } from "./CandidateList";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CandidateList", () => {
  it("loads exam options only on the first request and unlocks a candidate", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: "00000000-0000-4000-8000-000000000002",
              mer_code: "TEST-001",
              full_name: "නිර්මාණ පරීක්ෂක",
              outlet: "පුහුණු ශාඛාව",
              active: true,
              created_at: "2026-10-04T00:00:00.000Z",
              assigned_exam_count: 0,
            },
          ],
          total: 1,
          exam_options: [
            { id: "exam-1", title: "Synthetic Exam", status: "draft" },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ cleared: 2 }));

    render(<CandidateList />);

    expect(await screen.findByText("නිර්මාණ පරීක්ෂක")).toBeTruthy();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "include=exam_options",
    );
    expect(screen.getByRole("option", { name: "Synthetic Exam" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Unlock login" }));
    expect(
      await screen.findByText("Cleared 2 failed login attempts for TEST-001."),
    ).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });

    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "all" },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(String(fetchMock.mock.calls[2]?.[0])).not.toContain(
      "include=exam_options",
    );
  });
});
