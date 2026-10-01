-- =====================================================================
-- 001_smoke_test.sql  —  run AFTER 001_initial.sql, in the Supabase SQL editor.
-- Everything runs inside a transaction that is ROLLED BACK, so no data is left behind.
-- Success = the last notice says "SMOKE TEST PASSED". Any failure raises an error naming the check.
-- =====================================================================
begin;

do $$
declare
  v_exam    uuid := gen_random_uuid();
  v_cand    uuid := gen_random_uuid();
  v_q1      uuid := gen_random_uuid();
  v_q2      uuid := gen_random_uuid();
  v_q3      uuid := gen_random_uuid();
  v_opt     uuid := gen_random_uuid();
  v_att     uuid;
  v_first   uuid;
  v_second  uuid;
  v_res     text;
  v_pos     int;
begin
  -- Live sequential exam, 3 questions in the pool, 2 per paper
  insert into public.exams (id, title, duration_min, status, started_at, ends_at, navigation_mode, questions_per_paper)
  values (v_exam, 'Smoke test', 30, 'live', now(), now() + interval '30 minutes', 'sequential', 2);

  insert into public.questions (id, exam_id, position, type, body_html, marks) values
    (v_q1, v_exam, 0, 'mcq',     '<p>Q1</p>', 1),
    (v_q2, v_exam, 1, 'written', '<p>Q2</p>', 2),
    (v_q3, v_exam, 2, 'written', '<p>Q3</p>', 2);
  insert into public.mcq_options (id, question_id, position, label, text_html) values (v_opt, v_q1, 0, 'a', 'Yes');

  insert into public.candidates (id, mer_code, full_name, nic_hash) values (v_cand, 'SMOKE-1', 'Smoke Tester', 'x');
  insert into public.exam_candidates (exam_id, candidate_id) values (v_exam, v_cand);

  -- 1. Assigning a candidate creates their attempt
  select id into v_att from public.attempts where exam_id = v_exam and candidate_id = v_cand;
  assert v_att is not null, '1: attempt should be created on assignment';

  -- 2. Paper generation: refuses before acknowledge, then is idempotent
  begin
    perform public.generate_paper(v_att);
    assert false, '2a: generate_paper must refuse before acknowledge';
  exception when others then
    assert sqlerrm = 'not_acknowledged', '2a: expected not_acknowledged, got ' || sqlerrm;
  end;

  update public.attempts set status = 'acknowledged', acknowledged_at = now() where id = v_att;
  perform public.generate_paper(v_att);
  perform public.generate_paper(v_att);   -- second call must not create a second paper
  assert (select count(*) from public.attempt_questions where attempt_id = v_att) = 2, '2b: pool should give 2 of 3 questions';
  assert (select status from public.attempts where id = v_att) = 'in_progress', '2c: attempt should be in_progress';

  -- 3. Sequential navigation
  select question_id into v_first  from public.attempt_questions where attempt_id = v_att and position = 0;
  select question_id into v_second from public.attempt_questions where attempt_id = v_att and position = 1;

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 0, v_first, 'answer one', null, 1);
  assert v_res = 'advanced' and v_pos = 1, '3a: first Next should advance to 1, got ' || v_res;

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 0, v_first, 'answer one', null, 1);
  assert v_res = 'already_advanced' and v_pos = 1, '3b: retried Next must not skip a question, got ' || v_res;

  assert public.save_answer(v_att, v_first, 'edit after next', null, false, 2) = 'wrong_position',
    '3c: editing an earlier question must be rejected';

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 1, v_second, 'answer two', null, 1);
  assert v_res = 'last_question', '3d: last question should use Submit, got ' || v_res;

  -- 4. Revision rule: a stale revision never overwrites
  assert public.save_answer(v_att, v_second, 'rev 5', null, false, 5) = 'saved',          '4a: first save';
  assert public.save_answer(v_att, v_second, 'old',   null, false, 3) = 'stale_revision', '4b: stale revision';
  assert (select answer_text from public.answers where attempt_id = v_att and question_id = v_second) = 'rev 5',
    '4c: stale revision must not overwrite';

  -- 5. Submit, then everything is closed
  assert public.submit_attempt(v_att, 'manual') = true,  '5a: submit';
  assert public.submit_attempt(v_att, 'manual') = false, '5b: second submit is a no-op';
  assert public.save_answer(v_att, v_second, 'late', null, false, 9) = 'closed', '5c: save after submit must be closed';

  -- 6. Scores: an override always wins, even over a later AI row
  insert into public.question_scores (attempt_id, question_id, source, marks, max_marks) values (v_att, v_first, 'ai', 1, 2);
  insert into public.question_scores (attempt_id, question_id, source, marks, max_marks) values (v_att, v_first, 'override', 2, 2);
  insert into public.question_scores (attempt_id, question_id, source, marks, max_marks) values (v_att, v_first, 'ai', 0, 2);
  assert (select marks from public.current_scores where attempt_id = v_att and question_id = v_first) = 2,
    '6: override must win over later AI rows';

  -- 7. Violation incidents: only counting rows bump the badge number
  insert into public.violation_events (attempt_id, type, merged_types) values (v_att, 'FULLSCREEN_EXIT', array['FOCUS_LOST', 'VIEWPORT_CHANGED']);
  insert into public.violation_events (attempt_id, type, counts)       values (v_att, 'RECONNECTED', false);
  assert (select violation_count from public.attempts where id = v_att) = 1, '7a: only counting incidents are counted';

  -- 7b-d. Trigger UPDATE OF counts path (two-pass DISCONNECTED rule)
  declare v_evt uuid;
  begin
    insert into public.violation_events (attempt_id, type, counts) values (v_att, 'DISCONNECTED', false) returning id into v_evt;
    assert (select violation_count from public.attempts where id = v_att) = 1, '7b: insert with counts=false must not increment';

    update public.violation_events set counts = true where id = v_evt;
    assert (select violation_count from public.attempts where id = v_att) = 2, '7c: flip false->true must increment (+1)';

    update public.violation_events set counts = false where id = v_evt;
    assert (select violation_count from public.attempts where id = v_att) = 1, '7d: flip true->false must decrement (-1)';
  end;

  -- 8. Alert dedup: one ACTIVE alert per key
  insert into public.alerts (type, message, unique_key) values ('keys', 'all keys exhausted', 'keys-exhausted');
  begin
    insert into public.alerts (type, message, unique_key) values ('keys', 'again', 'keys-exhausted');
    assert false, '8: duplicate active alert must be rejected';
  exception when unique_violation then
    null;   -- expected
  end;

  -- 9. Grading job shape: several chunk jobs per candidate in one run
  declare v_run uuid := gen_random_uuid();
  begin
    insert into public.grading_runs (id, exam_id) values (v_run, v_exam);
    insert into public.grading_jobs (run_id, attempt_id, chunk_index, question_ids) values (v_run, v_att, 0, '[]'::jsonb), (v_run, v_att, 1, '[]'::jsonb);
  end;

  -- 10. resolve_disconnects(): overlap, flip, guard, and positive case
  declare v_disc uuid; v_disc2 uuid; v_disc3 uuid; v_vc_before int;
  begin
    update public.attempts set violation_count = 0 where id = v_att;

    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false, jsonb_build_object('last_seen_at', (now() - interval '5 minutes')::timestamptz::text))
    returning id into v_disc;

    update public.attempts set last_seen_at = (now() - interval '5 minutes') where id = v_att;

    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '5 minutes' - interval '5 seconds', 30000, false);

    perform public.resolve_disconnects();
    assert (select meta->>'count_reason' from public.violation_events where id = v_disc) = 'overlap',
      '10a: overlapping DISCONNECTED must get count_reason=overlap';
    assert (select violation_count from public.attempts where id = v_att) = 0,
      '10b: overlapping row must not increment violation_count';

    update public.violation_events set meta = jsonb_set(meta, '{count_reason}', 'null'::jsonb) where id = v_disc;

    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false, jsonb_build_object('last_seen_at', (now() - interval '4 minutes')::timestamptz::text))
    returning id into v_disc2;

    update public.attempts set last_seen_at = (now() - interval '4 minutes') where id = v_att;

    update public.violation_events
    set meta = jsonb_set(meta, '{count_reason}', '"short_gap"')
    where id = v_disc2 and counts = false and meta->>'count_reason' is null;

    perform public.resolve_disconnects();
    assert (select counts from public.violation_events where id = v_disc2) = false,
      '10c: short_gap guard must prevent flip';
    assert (select meta->>'count_reason' from public.violation_events where id = v_disc2) = 'short_gap',
      '10d: short_gap must not be overwritten by long_gap';

    v_vc_before := (select violation_count from public.attempts where id = v_att);

    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false, jsonb_build_object('last_seen_at', (now() - interval '10 minutes')::timestamptz::text))
    returning id into v_disc3;

    update public.attempts set last_seen_at = (now() - interval '10 minutes') where id = v_att;

    perform public.resolve_disconnects();
    assert (select counts from public.violation_events where id = v_disc3) = true,
      '10e: clean disconnect must flip to counts=true';
    assert (select meta->>'count_reason' from public.violation_events where id = v_disc3) = 'long_gap',
      '10f: clean disconnect must get count_reason=long_gap';
    assert (select violation_count from public.attempts where id = v_att) = v_vc_before + 1,
      '10g: clean disconnect must increment violation_count by 1';
  end;

  raise notice 'SMOKE TEST PASSED';
end $$;

rollback;
