import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadWorkerConfig } from "../src/config";
import { callGemini } from "../src/gemini";
import { buildPrompt } from "../src/prompt";
import { parseGradingResponse } from "../src/parser";
import type { ValidatedScore } from "../src/parser";
import { promptCaseReport } from "../src/prompt-report";

type Cases = { questions: Array<{ id: string; question: string; max_marks: number; model_answer: string; grading_notes: string; calibration: unknown }>; cases: Array<{ case: string; question: string; candidate_answer: string; expected_min: number; expected_max: number }> };

async function main(): Promise<void> {
  const config = loadWorkerConfig(); const key = config.grading.keys[0];
  const source = JSON.parse(await readFile(resolve("../Test/SECTIONS/grading-test-cases.json"), "utf8")) as Cases;
  for (let offset = 0; offset < source.cases.length; offset += 10) {
    const chunk = source.cases.slice(offset, offset + 10).map((test) => { const question = source.questions.find((item) => item.id === test.question); if (!question) throw new Error("test_question_missing"); return { questionId: test.case, questionHtml: question.question, answerText: test.candidate_answer, modelAnswer: question.model_answer, maxMarks: question.max_marks, gradingNotes: question.grading_notes, calibration: question.calibration }; });
    const prompt = buildPrompt(chunk, config.grading.maxAnswerChars, config.grading.promptVersion);
    const scores = new Map<string, ValidatedScore[]>();
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      const result = await callGemini({ key: key.key, user: prompt.user, timeoutMs: config.grading.requestTimeoutMs, thinking: config.grading.thinking });
      if (!result.ok) throw new Error("prompt_harness_call_failed");
      const parsed = parseGradingResponse(result.text, prompt.mapping, { markStep: config.grading.markStep, reviewConfidence: config.grading.reviewConfidence, reviewConfidenceSinglish: config.grading.reviewConfidenceSinglish, promptVersion: config.grading.promptVersion });
      for (const score of parsed.scores) scores.set(score.questionId, [...(scores.get(score.questionId) ?? []), score]);
      console.info(JSON.stringify({ event: "prompt_harness_call", chunk: offset / 10, repetition, key_label: key.label, ok: result.ok }));
    }
    for (const test of source.cases.slice(offset, offset + 10)) {
      const report = promptCaseReport(test, scores.get(test.case) ?? []);
      console.info(JSON.stringify(report));
      if (!report.in_range || !report.stable) throw new Error("prompt_harness_acceptance_failed");
    }
  }
}
void main().catch(() => { console.error(JSON.stringify({ event: "prompt_harness_failed", error_code: "harness_failed" })); process.exit(1); });
