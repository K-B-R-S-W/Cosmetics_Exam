import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireCandidate: vi.fn(), createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/candidate-session", () => ({ requireCandidate: mocks.requireCandidate }));
vi.mock("@/lib/supabase/server", () => ({ createServiceRoleClient: mocks.createClient }));
vi.mock("@/lib/question-server", () => ({ QUESTION_BUCKET: "question-images" }));

import { GET } from "./route";

const questionId = "00000000-0000-4000-8000-000000000011";

function database(data: unknown, download: unknown = { data: new Blob(["image"], { type: "image/png" }), error: null }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  const downloadMock = vi.fn().mockResolvedValue(download);
  const bucket = vi.fn(() => ({ download: downloadMock }));
  return { client: { from: vi.fn(() => chain), storage: { from: bucket } }, chain, downloadMock };
}

async function request(id = questionId) {
  return GET(new Request(`http://localhost/api/question-images/${id}`), { params: Promise.resolve({ questionId: id }) });
}

beforeEach(() => {
  mocks.requireCandidate.mockReset().mockResolvedValue({ candidateId: "candidate", attemptId: "attempt" });
  mocks.createClient.mockReset();
});

describe("GET /api/question-images/[questionId]", () => {
  it("validates the UUID after authenticating", async () => {
    const response = await request("not-a-uuid");
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("validation_failed");
    expect(mocks.requireCandidate).toHaveBeenCalledTimes(1);
  });

  it("returns the same 404 for a foreign question, absent image, or missing object", async () => {
    for (const setup of [
      database(null),
      database({ questions: { image_path: null, image_mime: null } }),
      database({ questions: { image_path: "questions/admin/object.png", image_mime: "image/png" } }, { data: null, error: { message: "missing" } }),
    ]) {
      mocks.createClient.mockReturnValueOnce(setup.client);
      const response = await request();
      expect(response.status).toBe(404);
      expect((await response.json()).error).toMatchObject({ code: "not_found", message: "The image was not found." });
    }
  });

  it("checks paper membership and streams the private object with approved headers", async () => {
    const setup = database({ questions: { image_path: "questions/admin/private.png", image_mime: "image/png" } });
    mocks.createClient.mockReturnValue(setup.client);
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300, no-transform");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(setup.chain.eq).toHaveBeenCalledWith("attempt_id", "attempt");
    expect(setup.chain.eq).toHaveBeenCalledWith("question_id", questionId);
    expect(setup.downloadMock).toHaveBeenCalledWith("questions/admin/private.png");
    expect(await response.text()).toBe("image");
  });
});
