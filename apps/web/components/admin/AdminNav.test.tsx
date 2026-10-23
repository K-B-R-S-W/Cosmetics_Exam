// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminNav } from "./AdminNav";

afterEach(cleanup);

describe("AdminNav", () => {
  it("shows admin management only to super admins", () => {
    const { rerender } = render(<AdminNav role="admin" />);
    expect(screen.queryByRole("link", { name: "Admins" })).toBeNull();
    rerender(<AdminNav role="super_admin" />);
    expect(screen.getByRole("link", { name: "Admins" }).getAttribute("href")).toBe("/admin/admins");
  });
});
