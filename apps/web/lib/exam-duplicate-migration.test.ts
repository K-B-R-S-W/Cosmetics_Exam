import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "../../supabase/migrations/014_exam_duplicate.sql"), "utf8");
const smoke = readFileSync(resolve(process.cwd(), "../../Test/SECTIONS/014_duplicate_smoke_test.sql"), "utf8");

describe("migration 014 contract", () => {
  it("is transactional, service-role-only, and resets the copied exam", () => {
    expect(migration).toMatch(/^-- ={10,}/);
    expect(migration).toContain("begin;");
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = public, pg_temp");
    expect(migration).toContain("left('Copy of ' || v_source_exam.title, 150)");
    expect(migration).toContain("'draft'");
    expect(migration).toContain("revoke execute on function public.duplicate_exam(uuid, uuid)");
    expect(migration).toContain("grant execute on function public.duplicate_exam(uuid, uuid) to service_role");
  });

  it("copies definition rows with new ids and leaves image attachment for Storage", () => {
    expect(migration).toContain("insert into public.questions");
    expect(migration).toContain("insert into public.mcq_options");
    expect(migration).toContain("insert into public.answer_keys");
    expect(migration).toContain("v_new_correct_option_id := v_new_option_id");
    expect(migration).toContain("'destination_path', v_destination_path");
    expect(migration).not.toContain("insert into public.attempts");
    expect(migration).not.toContain("insert into public.exam_candidates");
  });

  it("provides a rollback-only development smoke test for copy behavior", () => {
    expect(smoke).toContain("public.duplicate_exam(v_exam, v_admin)");
    expect(smoke).toContain("remapped correct option must belong to the copied MCQ");
    expect(smoke).toContain("duplicate must not copy attempts");
    expect(smoke.trimEnd().endsWith("rollback;")).toBe(true);
  });
});
