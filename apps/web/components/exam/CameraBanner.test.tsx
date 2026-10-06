// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CameraBanner, cameraBannerText } from "./CameraBanner";

afterEach(cleanup);

describe("CameraBanner", () => {
  it.each([
    [{ cameraLost: true, microphoneLost: false, connectionLost: false }, "Camera disconnected. Please reconnect. Your exam continues and this is recorded."],
    [{ cameraLost: false, microphoneLost: true, connectionLost: false }, "Microphone disconnected. Please reconnect. Your exam continues and this is recorded."],
    [{ cameraLost: true, microphoneLost: true, connectionLost: false }, "Camera and microphone disconnected. Please reconnect. Your exam continues and this is recorded."],
    [{ cameraLost: false, microphoneLost: false, connectionLost: true }, "Your exam continues. We're reconnecting your video to the exam team. You don't need to do anything."],
  ])("uses the exact approved copy", (state, text) => {
    expect(cameraBannerText(state)).toBe(text);
    render(<CameraBanner {...state} />);
    expect(screen.getByRole("alert").textContent).toContain(text);
  });

  it("lets device loss take priority over a LiveKit connection loss", () => {
    expect(cameraBannerText({ cameraLost: true, microphoneLost: false, connectionLost: true })).toMatch(/^Camera disconnected/);
  });
});
