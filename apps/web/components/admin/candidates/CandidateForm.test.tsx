// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateForm } from "./CandidateForm";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CandidateForm", () => {
  it("omits a blank ID when editing so the old hash is retained", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          candidate: {
            id: "00000000-0000-4000-8000-000000000002",
            mer_code: "TEST-001",
            full_name: "Synthetic Candidate",
            outlet: "Training Outlet",
            active: true,
            created_at: "2026-10-04T00:00:00.000Z",
            assigned_exam_count: 0,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ candidate: {} }));

    render(
      <CandidateForm candidateId="00000000-0000-4000-8000-000000000002" />,
    );

    const name = await screen.findByLabelText("Full name");
    fireEvent.change(name, { target: { value: "සංස්කරණ පරීක්ෂක" } });
    expect((screen.getByLabelText("ID number") as HTMLInputElement).value).toBe(
      "",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(request.method).toBe("PATCH");
    expect(body.full_name).toBe("සංස්කරණ පරීක්ෂක");
    expect(body).not.toHaveProperty("nic");
    expect(mocks.push).toHaveBeenCalledWith("/admin/candidates");
  });
});
