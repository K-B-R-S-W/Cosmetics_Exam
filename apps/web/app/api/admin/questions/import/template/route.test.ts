import Papa from "papaparse";
import { describe, expect, it, vi } from "vitest";

import { prepareQuestionImport, QUESTION_IMPORT_COLUMNS, type QuestionImportRow } from "@/lib/question-import";

const auth = vi.hoisted(() => vi.fn().mockResolvedValue({ id: "admin" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", async (original) => ({ ...(await original<typeof import("@/lib/auth")>()), requireAdmin: auth }));

describe("question import template", () => {
  it("downloads UTF-8 BOM CSV that parses cleanly with MCQ, written and Sinhala examples", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const text = await response.text();
    expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
    const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (header) => header.replace(/^\uFEFF/, "") });
    expect(parsed.errors).toEqual([]);
    expect(parsed.data.map((item) => item.type)).toEqual(["mcq", "written"]);
    expect(parsed.data[0]?.question).toContain("ශ්‍රී");
    const rows = parsed.data.map((item, index) => Object.assign(
      { source_row: index + 2 },
      Object.fromEntries(QUESTION_IMPORT_COLUMNS.map((column) => [column, item[column] ?? ""])),
    ) as unknown as QuestionImportRow);
    const roundTrip = prepareQuestionImport(rows, "00000000-0000-4000-8000-000000000100", []);
    expect(roundTrip.issues).toEqual([]);
    expect(roundTrip.ready.map((item) => item.document.type)).toEqual(["mcq", "written"]);
    expect(response.headers.get("content-disposition")).toContain("question-import-template.csv");
  });
});
