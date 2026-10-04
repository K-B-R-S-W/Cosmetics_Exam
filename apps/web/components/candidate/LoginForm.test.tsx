// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./LoginForm";

const mocks = vi.hoisted(() => ({ push: vi.fn(), searchGet: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => ({ get: mocks.searchGet }),
}));

const fetchMock = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  mocks.push.mockReset();
  mocks.searchGet.mockReset().mockReturnValue(null);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear(); });

function enterCredentials() {
  fireEvent.change(screen.getByLabelText("MER code"), { target: { value: "test-001" } });
  fireEvent.change(screen.getByLabelText("ID number"), { target: { value: "200012345678" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginForm", () => {
  it("shows the one generic credential error and clears only the ID", async () => {
    fetchMock.mockResolvedValue(response({ error: { code: "invalid_credentials", message: "ignored", details: null } }, 401));
    render(<LoginForm />);
    enterCredentials();
    expect((await screen.findByRole("alert")).textContent).toContain("Your MER code or ID number doesn't match our records.");
    expect((screen.getByLabelText("MER code") as HTMLInputElement).value).toBe("TEST-001");
    expect((screen.getByLabelText("ID number") as HTMLInputElement).value).toBe("");
  });

  it("shows a picker with no preselected exam and keeps the ID out of storage and URLs", async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { code: "multiple_exams", details: { exams: [
      { id: "00000000-0000-4000-8000-000000000001", title: "Exam A", status: "scheduled", scheduled_start_at: null },
      { id: "00000000-0000-4000-8000-000000000002", title: "Exam B", status: "live", scheduled_start_at: null },
    ] } } }, 409)).mockResolvedValueOnce(response({ next: "confirm" }));
    render(<LoginForm />);
    enterCredentials();
    expect(await screen.findByRole("heading", { name: "Choose your exam" })).toBeTruthy();
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    expect(JSON.stringify(sessionStorage)).not.toContain("200012345678");
    expect(JSON.stringify(localStorage)).not.toContain("200012345678");
    expect(location.href).not.toContain("200012345678");
    fireEvent.click(screen.getByRole("radio", { name: /Exam A/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/confirm"));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.nic).toBe("200012345678");
  });
});
