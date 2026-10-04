// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CandidateImport } from "./CandidateImport";

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  rows: [] as Array<Record<string, string>>,
}));

vi.mock("papaparse", () => ({
  default: { parse: mocks.parse },
}));

const fetchMock = vi.fn();

function syntheticRows(count: number): Array<Record<string, string>> {
  return Array.from({ length: count }, (_, index) => ({
    mer_code: `TEST-${String(index).padStart(3, "0")}`,
    full_name: index === 0 ? "නිර්මාණ පරීක්ෂක" : `Synthetic Candidate ${index}`,
    outlet: index === 0 ? "පුහුණු ශාඛාව" : "Training Outlet",
    nic: "190000000000",
  }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function chooseCsv(): void {
  const file = new File(["synthetic"], "synthetic.csv", { type: "text/csv" });
  fireEvent.change(screen.getByLabelText("Choose CSV"), {
    target: { files: [file] },
  });
}

function parsedRequest(call: unknown[]): {
  rows: Array<Record<string, string>>;
  dry_run: boolean;
  on_duplicate: "skip" | "update";
} {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as {
    rows: Array<Record<string, string>>;
    dry_run: boolean;
    on_duplicate: "skip" | "update";
  };
}

beforeEach(() => {
  mocks.rows = [];
  mocks.parse.mockReset().mockImplementation((_file: unknown, config: unknown) => {
    const complete = (config as {
      complete(result: {
        data: Array<Record<string, string>>;
        errors: unknown[];
        meta: { fields: string[] };
      }): void;
    }).complete;
    complete({
      data: mocks.rows,
      errors: [],
      meta: { fields: ["mer_code", "full_name", "outlet", "nic"] },
    });
  });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CandidateImport", () => {
  it("masks preview IDs, imports 230 rows in 50-row batches, and clears raw state", async () => {
    mocks.rows = syntheticRows(230);
    fetchMock.mockImplementation(
      async (_url: unknown, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as {
          rows: unknown[];
          dry_run: boolean;
        };
        return jsonResponse({
          dry_run: body.dry_run,
          created: body.rows.length,
          updated: 0,
          skipped: 0,
          errors: [],
        });
      },
    );
    render(<CandidateImport />);
    chooseCsv();

    expect(await screen.findByText("230 rows")).toBeTruthy();
    expect(screen.queryByText("190000000000")).toBeNull();
    expect(screen.getAllByText("•••••••••000")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));

    const importButton = await screen.findByRole("button", {
      name: "Import 230 candidates",
    });
    const dryRuns = fetchMock.mock.calls.map(parsedRequest);
    expect(dryRuns.map((call) => call.rows.length)).toEqual([50, 50, 50, 50, 30]);
    expect(dryRuns.every((call) => call.dry_run)).toBe(true);

    fireEvent.click(importButton);
    expect(await screen.findByText("Done.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(10);
    const imports = fetchMock.mock.calls.slice(5).map(parsedRequest);
    expect(imports.map((call) => call.rows.length)).toEqual([50, 50, 50, 50, 30]);
    expect(imports.every((call) => !call.dry_run)).toBe(true);
    expect(screen.queryByText("•••••••••000")).toBeNull();
    expect(screen.queryByText("230 rows")).toBeNull();
  });

  it("detects duplicates across the whole file and sends skip or update mode", async () => {
    mocks.rows = syntheticRows(52);
    mocks.rows[50] = { ...mocks.rows[50], mer_code: " test-000 " };
    fetchMock.mockImplementation(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { rows: unknown[]; dry_run: boolean };
      return jsonResponse({
        dry_run: body.dry_run,
        created: body.rows.length,
        updated: 0,
        skipped: 0,
        errors: [],
      });
    });
    render(<CandidateImport />);
    chooseCsv();

    fireEvent.click(await screen.findByRole("button", { name: "Check file" }));
    expect(
      await screen.findByText("This MER code is repeated earlier in the file."),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.slice(0, 2).map(parsedRequest).every((call) => call.on_duplicate === "skip")).toBe(true);

    fireEvent.click(screen.getByLabelText("Update it"));
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.slice(2, 4).map(parsedRequest).every((call) => call.on_duplicate === "update")).toBe(true);
  });

  it("stops after a partially completed import batch sequence", async () => {
    mocks.rows = syntheticRows(60);
    let importBatch = 0;
    fetchMock.mockImplementation(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { rows: unknown[]; dry_run: boolean };
      if (!body.dry_run) {
        importBatch += 1;
        if (importBatch === 2) {
          return jsonResponse(
            { error: { message: "Synthetic batch failure" } },
            503,
          );
        }
      }
      return jsonResponse({
        dry_run: body.dry_run,
        created: body.rows.length,
        updated: 0,
        skipped: 0,
        errors: [],
      });
    });
    render(<CandidateImport />);
    chooseCsv();
    fireEvent.click(await screen.findByRole("button", { name: "Check file" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Import 60 candidates" }),
    );

    expect(
      await screen.findByText(/The import stopped after 50 rows/),
    ).toBeTruthy();
  });

  it("blocks checking when likely file damage is present", async () => {
    mocks.rows = [
      { ...syntheticRows(1)[0], full_name: "???" },
      { ...syntheticRows(1)[0], mer_code: "TEST-002", outlet: "Bad \uFFFD text" },
      { ...syntheticRows(1)[0], mer_code: "TEST-003", nic: "1.9E+11" },
    ];
    render(<CandidateImport />);
    chooseCsv();

    expect(await screen.findByText(/This file may be damaged/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Check file" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
