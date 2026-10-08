import { expect, it } from "vitest";
import { csvCell, csvTextCell } from "./csv";

it("quotes commas, quotes and newlines using RFC 4180", () => {
  expect(csvCell("a,b")).toBe('"a,b"');
  expect(csvCell('a"b')).toBe('"a""b"');
  expect(csvCell("a\nb")).toBe('"a\nb"');
});

it.each(["=1+1", "+SUM(1)", "-1+1", "@SUM(1)", "\tformula"])("guards formula-like text %j", (value) => {
  expect(csvTextCell(value)).toBe(`'${value}`);
});

it("guards and quotes a leading carriage return", () => {
  expect(csvTextCell("\rformula")).toBe("\"'\rformula\"");
});

it("does not formula-guard numeric cells", () => {
  expect(csvCell(-1)).toBe("-1");
});
