// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GradingProgress } from "./GradingProgress";

afterEach(() => vi.unstubAllGlobals());
it("shows only key labels and queue counts", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ runs: [], queue: { pending: 2 }, keys: [{ label: "key1", status: "active", cooldown_until: null }], logs: [], not_graded: 0 }))));
  render(<GradingProgress examId="exam" attempts={[]} />);
  expect(await screen.findByText("key1: active")).toBeTruthy(); expect(screen.getByText("2")).toBeTruthy();
});
