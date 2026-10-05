-- =====================================================================
-- 001_smoke_test.sql  —  run AFTER migrations 001 through 007 in the Supabase SQL editor.
-- Everything runs inside a transaction that is ROLLED BACK, so no data is left behind.
-- Success = the final result-grid row says "SMOKE TEST PASSED". Any failure raises an error naming the check.
-- =====================================================================
begin;

-- Data API privileges are asserted by role name so these checks do not depend on
-- whichever role happens to run the SQL editor transaction.
do $$
declare
  t text;
  p text;
  f text;
  expected_authenticated_select boolean;
  base_tables constant text[] := array[
    'admin_profiles', 'candidates', 'exams', 'exam_candidates', 'questions', 'mcq_options',
    'answer_keys', 'attempts', 'attempt_questions', 'sessions', 'answers', 'violation_events',
    'grading_runs', 'grading_jobs', 'question_scores', 'results', 'api_key_state',
    'grading_log', 'login_attempts', 'alerts', 'system_health', 'admin_actions',
    'broadcasts', 'broadcast_recipients'
  ];
  views constant text[] := array['current_scores', 'attempt_progress', 'attempt_deadlines'];
  sequences constant text[] := array['grading_log_id_seq', 'login_attempts_id_seq', 'admin_actions_id_seq'];
  service_functions constant text[] := array[
    'public.resolve_disconnects()',
    'public.reverse_disconnects_for_incident(uuid)',
    'public.attempt_deadline(uuid)',
    'public.generate_paper(uuid)',
    'public.save_answer(uuid,uuid,text,uuid,boolean,integer)',
    'public.advance_position(uuid,integer,uuid,text,uuid,integer)',
    'public.submit_attempt(uuid,text)',
    'public.create_broadcast(uuid,text,text,uuid[])',
    'public.claim_broadcast(uuid,uuid,uuid)',
    'public.unassign_exam_candidates(uuid,uuid[])',
    'public.save_question(uuid,uuid,text,text,numeric,integer,text,text,text,integer,jsonb,uuid,text,text,jsonb)',
    'public.delete_question(uuid,uuid)',
    'public.reorder_questions(uuid,uuid[])',
    'public.save_answer_key(uuid,uuid,text,text,jsonb)',
    'public.start_exam(uuid,boolean)',
    'public.submit_due_attempt(uuid)',
    'public.finalize_exam_if_closed(uuid)'
  ];
begin
  assert not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (
         select 1
           from unnest(coalesce(p.proconfig, array[]::text[])) as config(value)
          where config.value like 'search_path=%'
       )
  ), 'grant 0: every public function must set search_path in proconfig';

  assert not has_schema_privilege('anon', 'public', 'USAGE'),
    'grant 0a: anon must not have public schema usage';
  assert has_schema_privilege('authenticated', 'public', 'USAGE'),
    'grant 0b: authenticated needs public schema usage';
  assert has_schema_privilege('service_role', 'public', 'USAGE'),
    'grant 0c: service_role needs public schema usage';

  foreach t in array (base_tables || views) loop
    assert not has_table_privilege('anon', format('public.%I', t), 'SELECT'),
      'grant 1a: anon SELECT leaked on ' || t;
    assert not has_table_privilege('anon', format('public.%I', t), 'INSERT'),
      'grant 1b: anon INSERT leaked on ' || t;

    expected_authenticated_select := t = any(array[
      'admin_profiles', 'attempts', 'violation_events', 'grading_jobs',
      'grading_log', 'alerts', 'exams'
    ]);
    assert has_table_privilege('authenticated', format('public.%I', t), 'SELECT') = expected_authenticated_select,
      'grant 1c: unexpected authenticated SELECT on ' || t;
    foreach p in array array['INSERT', 'UPDATE', 'DELETE'] loop
      assert not has_table_privilege('authenticated', format('public.%I', t), p),
        'grant 1d: authenticated ' || p || ' leaked on ' || t;
    end loop;
  end loop;

  foreach t in array base_tables loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      assert has_table_privilege('service_role', format('public.%I', t), p),
        'grant 2a: service_role lacks ' || p || ' on ' || t;
    end loop;
  end loop;
  foreach t in array views loop
    assert has_table_privilege('service_role', format('public.%I', t), 'SELECT'),
      'grant 2b: service_role lacks SELECT on ' || t;
  end loop;

  foreach t in array sequences loop
    assert not has_sequence_privilege('anon', format('public.%I', t), 'USAGE'),
      'grant 3a: anon sequence access leaked on ' || t;
    assert not has_sequence_privilege('authenticated', format('public.%I', t), 'USAGE'),
      'grant 3b: authenticated sequence access leaked on ' || t;
    assert has_sequence_privilege('service_role', format('public.%I', t), 'USAGE'),
      'grant 3c: service_role lacks sequence USAGE on ' || t;
    assert has_sequence_privilege('service_role', format('public.%I', t), 'SELECT'),
      'grant 3d: service_role lacks sequence SELECT on ' || t;
  end loop;

  assert has_function_privilege('authenticated', 'public.is_admin()', 'EXECUTE'),
    'grant 4a: authenticated needs is_admin';
  assert has_function_privilege('authenticated', 'public.is_super_admin()', 'EXECUTE'),
    'grant 4b: authenticated needs is_super_admin';
  foreach f in array service_functions loop
    assert not has_function_privilege('anon', f, 'EXECUTE'),
      'grant 4c: anon function access leaked on ' || f;
    assert not has_function_privilege('authenticated', f, 'EXECUTE'),
      'grant 4d: authenticated function access leaked on ' || f;
    assert has_function_privilege('service_role', f, 'EXECUTE'),
      'grant 4e: service_role lacks function access on ' || f;
  end loop;
end $$;

-- A few behavioral checks complement the ACL assertions above.
set local role anon;
do $$
begin
  begin
    perform 1 from public.exams limit 1;
    assert false, 'grant 5a: anon SELECT must be denied';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

set local role authenticated;
do $$
begin
  begin
    insert into public.exams (title, duration_min) values ('must fail', 1);
    assert false, 'grant 5b: authenticated INSERT must be denied';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;

set local role service_role;
select public.resolve_disconnects();
reset role;

do $$
declare
  v_exam    uuid := gen_random_uuid();
  v_cand    uuid := gen_random_uuid();
  v_cand2   uuid := gen_random_uuid();
  v_unknown uuid := gen_random_uuid();
  v_q1      uuid := gen_random_uuid();
  v_q2      uuid := gen_random_uuid();
  v_q3      uuid := gen_random_uuid();
  v_opt     uuid := gen_random_uuid();
  v_opt2    uuid := gen_random_uuid();
  v_att     uuid;
  v_first   uuid;
  v_second  uuid;
  v_third   uuid;
  v_res     text;
  v_pos     int;
  v_removed uuid[];
  v_blocked uuid[];
  v_paper_before jsonb;
  v_paper_after jsonb;
  v_broadcast uuid;
  v_recipient_count int;
  v_claim uuid := gen_random_uuid();
  v_display boolean;
  v_announcement text;
  i int;
begin
  assert (select column_default = '10'
            from information_schema.columns
           where table_schema = 'public' and table_name = 'exams' and column_name = 'flag_threshold'),
    '0: exams.flag_threshold must default to 10';
  assert not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'exams'
       and column_name = 'questions_per_paper'
  ), '0: questions_per_paper must be removed by migration 004';

  -- Live sequential exam. Every candidate receives all three composed questions.
  insert into public.exams (id, title, duration_min, status, started_at, ends_at, navigation_mode, shuffle)
  values (v_exam, 'Smoke test', 30, 'live', now(), now() + interval '30 minutes', 'sequential', false);

  insert into public.questions (id, exam_id, position, type, body_html, marks) values
    (v_q1, v_exam, 0, 'mcq',     '<p>Q1</p>', 1),
    (v_q2, v_exam, 1, 'written', '<p>Q2</p>', 2),
    (v_q3, v_exam, 2, 'written', '<p>Q3</p>', 2);

  -- 0. Optional question-image metadata is all-or-none. This specifically guards against
  -- SQL CHECK expressions accidentally accepting a half-filled row because they evaluate NULL.
  begin
    update public.questions set image_path = 'questions/half-filled.png' where id = v_q2;
    assert false, '0a: half-filled question image metadata must be rejected';
  exception when check_violation then
    null; -- expected
  end;
  begin
    update public.questions set image_alt_text = repeat('x', 501) where id = v_q2;
    assert false, '0d: question-image alt text above 500 characters must be rejected';
  exception when check_violation then
    null; -- expected
  end;
  update public.questions
     set image_path = 'questions/complete.png', image_alt_text = 'Product label',
         image_mime = 'image/png', image_size_bytes = 1024
   where id = v_q2;
  assert (select image_path from public.questions where id = v_q2) = 'questions/complete.png',
    '0b: complete question image metadata must be accepted';
  begin
    update public.questions set image_size_bytes = 4194305 where id = v_q2;
    assert false, '0c: question images above 4 MiB must be rejected';
  exception when check_violation then
    null; -- expected
  end;
  update public.questions
     set image_path = null, image_alt_text = null, image_mime = null, image_size_bytes = null
   where id = v_q2;
  insert into public.mcq_options (id, question_id, position, label, text_html) values
    (v_opt,  v_q1, 0, 'a', 'Yes'),
    (v_opt2, v_q1, 1, 'b', 'No');

  insert into public.candidates (id, mer_code, full_name, nic_hash) values
    (v_cand, 'SMOKE-1', 'Smoke Tester', 'x'),
    (v_cand2, 'SMOKE-2', 'Second Tester', 'y');
  insert into public.exam_candidates (exam_id, candidate_id) values
    (v_exam, v_cand), (v_exam, v_cand2);

  -- 1. Assigning a candidate creates their attempt
  select id into v_att from public.attempts where exam_id = v_exam and candidate_id = v_cand;
  assert v_att is not null, '1: attempt should be created on assignment';

  -- 1a. Announcements snapshot exact recipients and can be claimed once.
  select out_broadcast_id, out_recipient_count into v_broadcast, v_recipient_count
    from public.create_broadcast(v_exam, ' Private message ', 'custom', array[v_cand, v_cand]);
  assert v_recipient_count = 1, '1a: duplicate custom recipient ids must collapse to one row';
  assert (select message = 'Private message' and audience = 'custom'
            from public.broadcasts where id = v_broadcast),
    '1a: custom announcement metadata must be stored';
  assert exists (select 1 from public.broadcast_recipients where broadcast_id = v_broadcast and candidate_id = v_cand),
    '1a: selected candidate must receive the custom announcement';
  assert not exists (select 1 from public.broadcast_recipients where broadcast_id = v_broadcast and candidate_id = v_cand2),
    '1a: unselected candidate must not receive the custom announcement';
  begin
    update public.broadcast_recipients set shown_at = now()
     where broadcast_id = v_broadcast and candidate_id = v_cand;
    assert false, '1a: a half-filled announcement claim must be rejected';
  exception when check_violation then
    null; -- expected
  end;
  select out_display, out_message
    into v_display, v_announcement
    from public.claim_broadcast(v_broadcast, v_cand, v_claim);
  assert v_display and v_announcement = 'Private message',
    '1a: the intended candidate must claim the toast';
  assert (select shown_at is not null and claim_token is not null from public.broadcast_recipients
           where broadcast_id = v_broadcast and candidate_id = v_cand),
    '1a: claiming a toast must persist shown_at and its idempotency token';
  select out_display into v_display from public.claim_broadcast(v_broadcast, v_cand, v_claim);
  assert v_display, '1a: retrying a lost reply with the same token must replay safely';
  select out_display into v_display from public.claim_broadcast(v_broadcast, v_cand, gen_random_uuid());
  assert not v_display, '1a: a new token must not show an already-claimed toast again';
  select out_display into v_display from public.claim_broadcast(v_broadcast, v_cand2, gen_random_uuid());
  assert not v_display, '1a: an unselected candidate must not claim the toast';

  select out_broadcast_id, out_recipient_count into v_broadcast, v_recipient_count
    from public.create_broadcast(v_exam, 'Everyone', 'all', null);
  assert v_recipient_count = 2, '1b: all must snapshot every currently assigned candidate';
  begin
    perform public.create_broadcast(v_exam, 'Bad target', 'custom', array[gen_random_uuid()]);
    assert false, '1c: an unassigned custom recipient must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_recipient', '1c: expected invalid_recipient, got ' || sqlerrm;
  end;

  perform public.create_broadcast(v_exam, repeat('x', 5000), 'all', null);
  begin
    perform public.create_broadcast(v_exam, repeat('x', 5001), 'all', null);
    assert false, '1d: announcements above 5000 characters must be rejected';
  exception when others then
    assert sqlerrm = 'invalid_message', '1d: expected invalid_message, got ' || sqlerrm;
  end;

  for i in 1..11 loop
    perform public.create_broadcast(v_exam, 'Unlimited send ' || i, 'all', null);
  end loop;
  assert (select count(*) from public.broadcasts where exam_id = v_exam) > 10,
    '1e: more than 10 announcements per exam must be accepted';

  -- 2. Paper generation: refuses before acknowledge, then is idempotent
  begin
    perform public.generate_paper(v_att);
    assert false, '2a: generate_paper must refuse before acknowledge';
  exception when others then
    assert sqlerrm = 'not_acknowledged', '2a: expected not_acknowledged, got ' || sqlerrm;
  end;

  update public.attempts set status = 'acknowledged', acknowledged_at = now() where id = v_att;
  perform public.generate_paper(v_att);
  select jsonb_agg(
           jsonb_build_object(
             'question_id', question_id,
             'position', position,
             'option_order', option_order
           ) order by position
         )
    into v_paper_before
    from public.attempt_questions
   where attempt_id = v_att;

  perform public.generate_paper(v_att);   -- reconnect must return the saved paper
  select jsonb_agg(
           jsonb_build_object(
             'question_id', question_id,
             'position', position,
             'option_order', option_order
           ) order by position
         )
    into v_paper_after
    from public.attempt_questions
   where attempt_id = v_att;

  assert (select count(*) from public.attempt_questions where attempt_id = v_att) = 3,
    '2b: every composed question must be assigned';
  assert (select array_agg(question_id order by position) = array[v_q1, v_q2, v_q3]
            from public.attempt_questions where attempt_id = v_att),
    '2c: shuffle=false must preserve authored question order';
  assert (select option_order = to_jsonb(array[v_opt, v_opt2])
            from public.attempt_questions
           where attempt_id = v_att and question_id = v_q1),
    '2c: shuffle=false must preserve authored MCQ option order';
  assert v_paper_after = v_paper_before,
    '2d: reconnect must preserve question and option order';
  assert (select status from public.attempts where id = v_att) = 'in_progress',
    '2d: attempt should be in_progress';

  -- 2e. Mixed unassign is atomic: the unstarted attempt is removed, the started
  -- attempt is blocked, duplicate and unknown ids are ignored.
  select removed, blocked into v_removed, v_blocked
    from public.unassign_exam_candidates(
      v_exam,
      array[v_cand, v_cand2, v_unknown, v_cand2]
    );
  assert v_removed = array[v_cand2], '2e: unstarted candidate must be removed';
  assert v_blocked = array[v_cand], '2e: started candidate must be blocked';
  assert not exists (
    select 1 from public.exam_candidates
     where exam_id = v_exam and candidate_id = v_cand2
  ), '2e: removed assignment must be deleted';
  assert not exists (
    select 1 from public.attempts
     where exam_id = v_exam and candidate_id = v_cand2
  ), '2e: trigger must delete the removed not_started attempt';
  assert exists (
    select 1 from public.exam_candidates
     where exam_id = v_exam and candidate_id = v_cand
  ), '2e: blocked assignment must remain';

  -- 2f. A live exam with no composed questions fails clearly.
  declare
    v_empty_exam uuid := gen_random_uuid();
    v_empty_cand uuid := gen_random_uuid();
    v_empty_att  uuid;
  begin
    insert into public.exams (id, title, duration_min, status, started_at, ends_at)
    values (v_empty_exam, 'Empty smoke exam', 30, 'live', now(), now() + interval '30 minutes');
    insert into public.candidates (id, mer_code, full_name, nic_hash)
    values (v_empty_cand, 'SMOKE-EMPTY', 'Empty Exam Tester', 'z');
    insert into public.exam_candidates (exam_id, candidate_id)
    values (v_empty_exam, v_empty_cand);
    update public.attempts
       set status = 'acknowledged', acknowledged_at = now()
     where exam_id = v_empty_exam and candidate_id = v_empty_cand
     returning id into v_empty_att;
    begin
      perform public.generate_paper(v_empty_att);
      assert false, '2f: an exam with zero questions must be rejected';
    exception when others then
      assert sqlerrm = 'exam_has_no_questions',
        '2f: expected exam_has_no_questions, got ' || sqlerrm;
    end;

    update public.exams set status = 'ended' where id = v_empty_exam;
    begin
      perform 1 from public.unassign_exam_candidates(v_empty_exam, array[v_empty_cand]);
      assert false, '2f: ended exams must reject unassignment';
    exception when others then
      assert sqlerrm = 'exam_locked',
        '2f: expected exam_locked from ended unassign, got ' || sqlerrm;
    end;
  end;

  -- 2g. Report environment-specific timing for a paper of about 100 questions.
  -- It is informational only; project load makes a fixed threshold brittle.
  declare
    v_perf_exam uuid := gen_random_uuid();
    v_perf_cand uuid := gen_random_uuid();
    v_perf_att  uuid;
    v_started   timestamptz;
    v_elapsed_ms numeric;
  begin
    insert into public.exams (id, title, duration_min, status, started_at, ends_at, shuffle)
    values (v_perf_exam, '100-question timing exam', 30, 'live', now(), now() + interval '30 minutes', true);
    insert into public.questions (exam_id, position, type, body_html)
    select v_perf_exam, n - 1, 'written', '<p>Timing question ' || n || '</p>'
      from generate_series(1, 100) as n;
    insert into public.candidates (id, mer_code, full_name, nic_hash)
    values (v_perf_cand, 'SMOKE-PERF', 'Timing Tester', 'p');
    insert into public.exam_candidates (exam_id, candidate_id)
    values (v_perf_exam, v_perf_cand);
    update public.attempts
       set status = 'acknowledged', acknowledged_at = now()
     where exam_id = v_perf_exam and candidate_id = v_perf_cand
     returning id into v_perf_att;

    v_started := clock_timestamp();
    perform public.generate_paper(v_perf_att);
    v_elapsed_ms := extract(epoch from (clock_timestamp() - v_started)) * 1000;

    assert (select count(*) from public.attempt_questions where attempt_id = v_perf_att) = 100,
      '2g: 100-question paper must contain all questions';
    perform set_config(
      'app.smoke_generate_paper_ms',
      round(v_elapsed_ms, 2)::text,
      true
    );
    raise notice 'generate_paper 100-question timing: % ms', round(v_elapsed_ms, 2);
  end;

  -- 3. Sequential navigation
  select question_id into v_first  from public.attempt_questions where attempt_id = v_att and position = 0;
  select question_id into v_second from public.attempt_questions where attempt_id = v_att and position = 1;
  select question_id into v_third  from public.attempt_questions where attempt_id = v_att and position = 2;

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 0, v_first, 'answer one', null, 1);
  assert v_res = 'advanced' and v_pos = 1, '3a: first Next should advance to 1, got ' || v_res;

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 0, v_first, 'answer one', null, 1);
  assert v_res = 'already_advanced' and v_pos = 1, '3b: retried Next must not skip a question, got ' || v_res;

  assert public.save_answer(v_att, v_first, 'edit after next', null, false, 2) = 'wrong_position',
    '3c: editing an earlier question must be rejected';

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 1, v_second, 'answer two', null, 1);
  assert v_res = 'advanced' and v_pos = 2, '3d: second Next should advance to 2, got ' || v_res;

  select out_result, out_position into v_res, v_pos from public.advance_position(v_att, 2, v_third, 'answer three', null, 1);
  assert v_res = 'last_question', '3e: last question should use Submit, got ' || v_res;
  assert (select answer_text from public.answers where attempt_id = v_att and question_id = v_third) = 'answer three',
    '3e: last-question answer must be saved before returning last_question';

  -- 4. Revision rule: a stale revision never overwrites
  assert public.save_answer(v_att, v_third, 'rev 5', null, false, 5) = 'saved',          '4a: first save';
  assert public.save_answer(v_att, v_third, 'old',   null, false, 3) = 'stale_revision', '4b: stale revision';
  assert (select answer_text from public.answers where attempt_id = v_att and question_id = v_third) = 'rev 5',
    '4c: stale revision must not overwrite';

  -- 5. Submit, then everything is closed
  assert public.submit_attempt(v_att, 'manual') = true,  '5a: submit';
  assert public.submit_attempt(v_att, 'manual') = false, '5b: second submit is a no-op';
  assert public.save_answer(v_att, v_third, 'late', null, false, 9) = 'closed', '5c: save after submit must be closed';

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
  declare v_disc uuid; v_disc2 uuid; v_disc3 uuid; v_disc4 uuid; v_vc_before int;
  begin
    update public.attempts set status = 'in_progress', violation_count = 0 where id = v_att;

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

    delete from public.violation_events where attempt_id = v_att and type in ('TAB_HIDDEN','FOCUS_LOST','FULLSCREEN_EXIT','VIEWPORT_CHANGED');

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

    update public.attempts set status = 'submitted' where id = v_att;

    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false, jsonb_build_object('last_seen_at', (now() - interval '15 minutes')::timestamptz::text))
    returning id into v_disc4;

    update public.attempts set last_seen_at = (now() - interval '15 minutes') where id = v_att;

    perform public.resolve_disconnects();
    assert (select counts from public.violation_events where id = v_disc4) = false,
      '10h: submitted attempt disconnect must not flip';
  end;

  -- 11. One absence counts once (section 4, section 5)
  declare v_d1 uuid; v_d2 uuid; v_f2 uuid; v_d3 uuid; v_f3 uuid;
  begin
    delete from public.violation_events where attempt_id = v_att;
    update public.attempts
      set status = 'in_progress', violation_count = 0,
          last_seen_at = now() - interval '6 minutes'
      where id = v_att;
    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false,
            jsonb_build_object('last_seen_at', (now() - interval '6 minutes')::timestamptz::text))
    returning id into v_d1;
    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '5 minutes', 30000, false);
    perform public.resolve_disconnects();
    assert (select meta->>'count_reason' from public.violation_events where id = v_d1) = 'overlap',
      '11a: incident inside the gap must mark the disconnect overlap';

    delete from public.violation_events where attempt_id = v_att;
    update public.attempts
      set violation_count = 0, last_seen_at = now() - interval '6 minutes'
      where id = v_att;
    insert into public.violation_events (attempt_id, type, counts, meta)
    values (v_att, 'DISCONNECTED', false,
            jsonb_build_object('last_seen_at', (now() - interval '6 minutes')::timestamptz::text))
    returning id into v_d2;
    perform public.resolve_disconnects();
    assert (select counts from public.violation_events where id = v_d2) = true, '11b-pre: flips to counted';
    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '5 minutes', 30000, true)
    returning id into v_f2;
    assert public.reverse_disconnects_for_incident(v_f2) = 1, '11b: one disconnect reversed';
    assert (select meta->>'count_reason' from public.violation_events where id = v_d2) = 'reversed_by_focus',
      '11b: reason must be reversed_by_focus';
    assert (select violation_count from public.attempts where id = v_att) = 1,
      '11b: net count must be 1 (the tab switch), not 2';

    delete from public.violation_events where attempt_id = v_att;
    update public.attempts
      set violation_count = 0, last_seen_at = now() - interval '6 minutes'
      where id = v_att;
    insert into public.violation_events (attempt_id, type, occurred_at, counts, meta)
    values (v_att, 'DISCONNECTED', now() - interval '5 minutes', false,
            jsonb_build_object('last_seen_at', (now() - interval '6 minutes')::timestamptz::text))
    returning id into v_d3;
    perform public.resolve_disconnects();
    insert into public.violation_events (attempt_id, type, occurred_at, counts, duration_ms)
    values (v_att, 'RECONNECTED', now() - interval '2 minutes', false, 240000);
    insert into public.violation_events (attempt_id, type, occurred_at, duration_ms, counts)
    values (v_att, 'FOCUS_LOST', now() - interval '1 minute', 10000, true)
    returning id into v_f3;
    assert public.reverse_disconnects_for_incident(v_f3) = 0,
      '11c: incident after the reconnect must not reverse the disconnect';
    assert (select counts from public.violation_events where id = v_d3) = true,
      '11c: disconnect stays counted';
  end;

  -- 12. Idempotent AI writes: one job can score a question only once (needs 002_grading.sql)
  declare v_run2 uuid := gen_random_uuid(); v_job uuid := gen_random_uuid();
  begin
    insert into public.grading_runs (id, exam_id) values (v_run2, v_exam);
    insert into public.grading_jobs (id, run_id, attempt_id, chunk_index, question_ids)
    values (v_job, v_run2, v_att, 0, '[]'::jsonb);

    insert into public.question_scores (attempt_id, question_id, source, marks, max_marks, job_id)
    values (v_att, v_first, 'ai', 1, 2, v_job);
    insert into public.question_scores (attempt_id, question_id, source, marks, max_marks, job_id)
    values (v_att, v_first, 'ai', 1, 2, v_job)
    on conflict do nothing;                      -- how the worker writes
    assert (select count(*) from public.question_scores where job_id = v_job) = 1,
      '12a: a duplicate score for the same job and question must be ignored';

    begin
      insert into public.question_scores (attempt_id, question_id, source, marks, max_marks, job_id)
      values (v_att, v_first, 'ai', 2, 2, v_job);
      assert false, '12b: a plain duplicate insert must violate the unique index';
    exception when unique_violation then
      null;                                      -- expected
    end;
  end;

  -- 13. Admin force-end collection window accepts the candidate's final partial answer,
  -- then closes after 15 seconds.
  update public.attempts
     set status = 'in_progress', submit_reason = null, submitted_at = null, current_position = 2
   where id = v_att;
  update public.exams
     set status = 'ended', ends_at = now(), force_ended_at = now()
   where id = v_exam;
  assert public.save_answer(v_att, v_third, 'partial final answer', null, false, 10) = 'saved',
    '13a: force-end window must accept the latest partial answer';
  update public.exams set force_ended_at = now() - interval '16 seconds' where id = v_exam;
  assert public.save_answer(v_att, v_third, 'too late', null, false, 11) = 'closed',
    '13b: force-end window must close after 15 seconds';

end $$;

-- 14. Question-builder RPCs are atomic, retryable and status-guarded (migration 005).
do $$
declare
  v_exam uuid := gen_random_uuid();
  v_other_exam uuid := gen_random_uuid();
  v_live_exam uuid := gen_random_uuid();
  v_question uuid := gen_random_uuid();
  v_question2 uuid := gen_random_uuid();
  v_failed_question uuid := gen_random_uuid();
  v_bad_key_question uuid := gen_random_uuid();
  v_foreign_question uuid := gen_random_uuid();
  v_live_question uuid := gen_random_uuid();
  v_option1 uuid := gen_random_uuid();
  v_option2 uuid := gen_random_uuid();
  v_failed_option uuid := gen_random_uuid();
  v_bad_option1 uuid := gen_random_uuid();
  v_bad_option2 uuid := gen_random_uuid();
  v_position int;
begin
  insert into public.exams (id, title, duration_min, status) values
    (v_exam, 'Question RPC smoke', 30, 'draft'),
    (v_other_exam, 'Other question RPC smoke', 30, 'draft');
  insert into public.exams (
    id, title, duration_min, status, started_at, ends_at
  ) values (
    v_live_exam, 'Live question RPC smoke', 30, 'live', now(), now() + interval '30 minutes'
  );

  select out_position into v_position
    from public.save_question(
      v_question, v_exam, 'mcq', '<p>Atomic MCQ</p>', null, null,
      null, null, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_option1, 'text_html', '<p>One</p>'),
        jsonb_build_object('id', v_option2, 'text_html', '<p>Two</p>')
      ),
      v_option1, null, null, '[]'::jsonb
    );
  assert v_position = 0, '14a: first question must receive position zero';
  assert (select marks from public.questions where id = v_question) = 1,
    '14a: omitted marks must be stored as one';
  assert (select correct_option_id from public.answer_keys where question_id = v_question) = v_option1,
    '14a: question, options and key must save together';

  -- Retrying the exact client-generated ids updates the same rows.
  perform public.save_question(
    v_question, v_exam, 'mcq', '<p>Atomic MCQ retry</p>', 2, null,
    null, null, null, null,
    jsonb_build_array(
      jsonb_build_object('id', v_option1, 'text_html', '<p>One updated</p>'),
      jsonb_build_object('id', v_option2, 'text_html', '<p>Two updated</p>')
    ),
    v_option2, null, null, '[]'::jsonb
  );
  assert (select count(*) from public.questions where id = v_question) = 1,
    '14b: an idempotent retry must not duplicate the question';
  assert (select count(*) from public.mcq_options where question_id = v_question) = 2,
    '14b: an idempotent retry must not duplicate options';
  assert (select body_html = '<p>Atomic MCQ retry</p>' and marks = 2
            from public.questions where id = v_question),
    '14b: an idempotent retry must update question fields';
  assert (select correct_option_id from public.answer_keys where question_id = v_question) = v_option2,
    '14b: an idempotent retry must update the key';

  -- A failure during option insertion rolls the earlier question upsert back.
  begin
    perform public.save_question(
      v_failed_question, v_exam, 'mcq', '<p>Must roll back</p>', 1, null,
      null, null, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_failed_option, 'text_html', '<p>Duplicate one</p>'),
        jsonb_build_object('id', v_failed_option, 'text_html', '<p>Duplicate two</p>')
      ),
      v_failed_option, null, null, '[]'::jsonb
    );
    assert false, '14c: duplicate option ids must fail';
  exception when others then
    assert sqlerrm = 'validation_failed',
      '14c: expected validation_failed for duplicate options, got ' || sqlerrm;
  end;
  assert not exists (select 1 from public.questions where id = v_failed_question),
    '14c: option failure must roll back the question upsert';
  assert not exists (select 1 from public.mcq_options where id = v_failed_option),
    '14c: option failure must leave no option rows';

  insert into public.questions (
    id, exam_id, position, type, body_html, marks
  ) values (
    v_foreign_question, v_other_exam, 0, 'written', '<p>Foreign</p>', 1
  );
  begin
    perform public.save_question(
      v_foreign_question, v_exam, 'written', '<p>Collision</p>', 1, null,
      null, null, null, null, '[]'::jsonb, null, 'Answer', null, '[]'::jsonb
    );
    assert false, '14d: a question id from another exam must be rejected';
  exception when others then
    assert sqlerrm = 'not_found', '14d: expected not_found, got ' || sqlerrm;
  end;
  assert (select exam_id from public.questions where id = v_foreign_question) = v_other_exam,
    '14d: a foreign-exam collision must not modify the existing question';

  begin
    perform public.save_question(
      v_bad_key_question, v_exam, 'mcq', '<p>Bad key</p>', 1, null,
      null, null, null, null,
      jsonb_build_array(
        jsonb_build_object('id', v_bad_option1, 'text_html', '<p>One</p>'),
        jsonb_build_object('id', v_bad_option2, 'text_html', '<p>Two</p>')
      ),
      gen_random_uuid(), null, null, '[]'::jsonb
    );
    assert false, '14e: a foreign correct option must be rejected';
  exception when others then
    assert sqlerrm = 'bad_correct_option',
      '14e: expected bad_correct_option, got ' || sqlerrm;
  end;
  assert not exists (select 1 from public.questions where id = v_bad_key_question),
    '14e: a bad correct option must roll back the whole save';

  insert into public.questions (
    id, exam_id, position, type, body_html, marks
  ) values (
    v_live_question, v_live_exam, 0, 'written', '<p>Locked</p>', 1
  );
  begin
    perform public.save_question(
      gen_random_uuid(), v_live_exam, 'written', '<p>Too late</p>', 1, null,
      null, null, null, null, '[]'::jsonb, null, null, null, '[]'::jsonb
    );
    assert false, '14f: save_question must reject a live exam';
  exception when others then
    assert sqlerrm = 'exam_locked', '14f: expected exam_locked, got ' || sqlerrm;
  end;
  begin
    perform public.delete_question(v_live_exam, v_live_question);
    assert false, '14g: delete_question must reject a live exam';
  exception when others then
    assert sqlerrm = 'exam_locked', '14g: expected exam_locked, got ' || sqlerrm;
  end;
  begin
    perform public.reorder_questions(v_live_exam, array[v_live_question]);
    assert false, '14h: reorder_questions must reject a live exam';
  exception when others then
    assert sqlerrm = 'exam_locked', '14h: expected exam_locked, got ' || sqlerrm;
  end;
  assert not public.save_answer_key(
    v_live_question, null, 'Live answer key', 'Allowed after start', '[]'::jsonb
  ), '14h: save_answer_key must remain available on a live exam';

  perform public.save_question(
    v_question2, v_exam, 'written', '<p>Written</p>', 3, null,
    null, null, null, null, '[]'::jsonb, null,
    'Model answer', 'Notes', '[]'::jsonb
  );
  assert public.reorder_questions(v_exam, array[v_question2, v_question]) = 2,
    '14i: reorder must update every question';
  assert (select position from public.questions where id = v_question2) = 0
     and (select position from public.questions where id = v_question) = 1,
    '14i: reorder must assign positions 0..n-1';
  begin
    perform public.reorder_questions(v_exam, array[v_question]);
    assert false, '14j: reorder must require the exact question set';
  exception when others then
    assert sqlerrm = 'validation_failed',
      '14j: expected validation_failed, got ' || sqlerrm;
  end;

  insert into public.grading_runs (exam_id, status) values (v_exam, 'running');
  begin
    perform public.save_answer_key(v_question2, null, 'Changed', 'Changed', '[]'::jsonb);
    assert false, '14k: answer keys must lock during grading';
  exception when others then
    assert sqlerrm = 'grading_in_progress',
      '14k: expected grading_in_progress, got ' || sqlerrm;
  end;
end $$;

-- 15. Scheduler RPCs use the database clock, submit every open attempt state,
-- preserve a visible ended tick, and never resurrect an ended exam (migration 006).
do $$
declare
  v_exam uuid := gen_random_uuid();
  v_unready_exam uuid := gen_random_uuid();
  v_future_exam uuid := gen_random_uuid();
  v_force_exam uuid := gen_random_uuid();
  v_question uuid := gen_random_uuid();
  v_candidate1 uuid := gen_random_uuid();
  v_candidate2 uuid := gen_random_uuid();
  v_candidate3 uuid := gen_random_uuid();
  v_attempt1 uuid;
  v_attempt2 uuid;
  v_attempt3 uuid;
  v_future_attempt uuid;
  v_force_attempt uuid;
  v_result text;
  v_reason text;
  v_status text;
  v_missing text[];
  v_finalized int;
begin
  insert into public.candidates (id, mer_code, full_name, nic_hash) values
    (v_candidate1, 'SCHED-001', 'Scheduler Candidate One', 'synthetic-hash'),
    (v_candidate2, 'SCHED-002', 'Scheduler Candidate Two', 'synthetic-hash'),
    (v_candidate3, 'SCHED-003', 'Scheduler Candidate Three', 'synthetic-hash');

  insert into public.exams (
    id, title, scheduled_start_at, duration_min, status
  ) values (
    v_unready_exam, 'Unready scheduler smoke', now() - interval '1 minute', 30, 'scheduled'
  );

  select out_result, out_missing into v_result, v_missing
    from public.start_exam(v_unready_exam, true);
  assert v_result = 'not_ready', '15a: an unready scheduled exam must stay scheduled';
  assert v_missing = array['questions', 'candidates']::text[],
    '15a: start must report only the missing readiness categories';
  assert (select status from public.exams where id = v_unready_exam) = 'scheduled',
    '15a: an unready exam must not change status';

  insert into public.exams (
    id, title, scheduled_start_at, duration_min, status
  ) values (
    v_exam, 'Scheduler smoke', now() - interval '1 minute', 30, 'scheduled'
  );
  insert into public.questions (id, exam_id, position, type, body_html, marks)
  values (v_question, v_exam, 0, 'written', '<p>Scheduler question</p>', 1);
  insert into public.exam_candidates (exam_id, candidate_id) values
    (v_exam, v_candidate1), (v_exam, v_candidate2), (v_exam, v_candidate3);

  select out_result, out_status into v_result, v_status
    from public.start_exam(v_exam, true);
  assert v_result = 'started' and v_status = 'live',
    '15b: a due and ready scheduled exam must start';
  assert (select started_at is not null and ends_at > started_at
            from public.exams where id = v_exam),
    '15b: start must set both timestamps from the database clock';

  select id into v_attempt1 from public.attempts
   where exam_id = v_exam and candidate_id = v_candidate1;
  select id into v_attempt2 from public.attempts
   where exam_id = v_exam and candidate_id = v_candidate2;
  select id into v_attempt3 from public.attempts
   where exam_id = v_exam and candidate_id = v_candidate3;
  update public.attempts set status = 'acknowledged', acknowledged_at = now()
   where id = v_attempt2;
  update public.attempts set status = 'in_progress', joined_at = now()
   where id = v_attempt3;
  update public.exams set ends_at = now() - interval '16 seconds' where id = v_exam;

  select out_result, out_reason into v_result, v_reason
    from public.submit_due_attempt(v_attempt1);
  assert v_result = 'submitted' and v_reason = 'auto',
    '15c: a due not-started attempt must auto-submit';
  select out_result, out_reason into v_result, v_reason
    from public.submit_due_attempt(v_attempt2);
  assert v_result = 'submitted' and v_reason = 'auto',
    '15c: a due acknowledged attempt must auto-submit';
  select out_result, out_reason into v_result, v_reason
    from public.submit_due_attempt(v_attempt3);
  assert v_result = 'submitted' and v_reason = 'auto',
    '15c: a due in-progress attempt must auto-submit';
  select out_result, out_reason into v_result, v_reason
    from public.submit_due_attempt(v_attempt3);
  assert v_result = 'already_submitted' and v_reason = 'auto',
    '15c: retrying a due submission must be idempotent';
  assert not exists (
    select 1 from public.answers a where a.attempt_id in (v_attempt1, v_attempt2, v_attempt3)
  ), '15c: scheduler submission must not synthesize answers';

  select out_result, out_exam_status into v_result, v_status
    from public.finalize_exam_if_closed(v_exam);
  assert v_result = 'ended' and v_status = 'ended',
    '15d: the first lifecycle pass must leave an ordinary exam ended';
  assert (select bool_and(status = 'submitted') from public.attempts where exam_id = v_exam),
    '15d: attempts must remain submitted during the observable ended tick';

  select out_result, out_exam_status, out_finalized_attempts
    into v_result, v_status, v_finalized
    from public.finalize_exam_if_closed(v_exam);
  assert v_result = 'finalized' and v_status = 'finalized' and v_finalized = 3,
    '15e: the next lifecycle pass must finalize the exam and submitted attempts';
  assert (select bool_and(status = 'finalized') from public.attempts where exam_id = v_exam),
    '15e: every submitted attempt must be finalized';

  select out_result into v_result from public.start_exam(v_exam, false);
  assert v_result = 'invalid_status'
     and (select status from public.exams where id = v_exam) = 'finalized',
    '15f: an ended or finalized exam must never be resurrected';

  insert into public.exams (
    id, title, scheduled_start_at, started_at, ends_at, duration_min, status
  ) values (
    v_future_exam, 'Future scheduler smoke', now() + interval '5 minutes',
    now(), now() + interval '5 minutes', 30, 'live'
  );
  insert into public.exam_candidates (exam_id, candidate_id)
  values (v_future_exam, v_candidate1);
  select id into v_future_attempt from public.attempts
   where exam_id = v_future_exam and candidate_id = v_candidate1;
  select out_result into v_result from public.submit_due_attempt(v_future_attempt);
  assert v_result = 'not_due'
     and (select status from public.attempts where id = v_future_attempt) = 'not_started',
    '15g: the database clock must refuse an early submission';

  insert into public.exams (
    id, title, scheduled_start_at, started_at, ends_at, force_ended_at, duration_min, status
  ) values (
    v_force_exam, 'Force scheduler smoke', now() - interval '1 hour',
    now() - interval '30 minutes', now() - interval '16 seconds',
    now() - interval '16 seconds', 30, 'ended'
  );
  insert into public.exam_candidates (exam_id, candidate_id)
  values (v_force_exam, v_candidate2);
  select id into v_force_attempt from public.attempts
   where exam_id = v_force_exam and candidate_id = v_candidate2;
  select out_result, out_reason into v_result, v_reason
    from public.submit_due_attempt(v_force_attempt);
  assert v_result = 'submitted' and v_reason = 'forced',
    '15h: a remaining force-ended attempt must submit as forced after 15 seconds';
  select out_result, out_exam_status, out_finalized_attempts
    into v_result, v_status, v_finalized
    from public.finalize_exam_if_closed(v_force_exam);
  assert v_result = 'finalized' and v_status = 'finalized' and v_finalized = 1,
    '15h: a force-ended exam may finalize once collection is closed';
end $$;

-- 16. Proctoring RPCs added by 007_proctoring.sql.
-- FOR UPDATE SKIP LOCKED concurrency needs the documented two-session
-- rehearsal; one SQL-editor transaction cannot prove that behaviour.
do $$
declare
  v_exam uuid := gen_random_uuid();
  v_candidate uuid := gen_random_uuid();
  v_submitted_candidate uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_attempt uuid;
  v_submitted_attempt uuid;
  v_session uuid := gen_random_uuid();
  v_event uuid := gen_random_uuid();
  v_disconnect uuid;
  v_review_event uuid;
  v_review_disconnect uuid;
  v_review_focus uuid;
  v_result text;
  v_counts boolean;
  v_snapshot text;
  v_state jsonb;
  v_before int;
  v_audit_before int;
  i int;
  f text;
  service_functions constant text[] := array[
    'public.record_candidate_event(uuid,uuid,text,text[],integer,integer,jsonb,boolean)',
    'public.mark_violation_snapshot_failed(uuid)',
    'public.classify_disconnect(uuid,uuid,timestamp with time zone)',
    'public.candidate_heartbeat(uuid)',
    'public.record_login_violation(uuid,text,jsonb)',
    'public.record_disconnects()',
    'public.resolve_disconnects()',
    'public.reverse_disconnects_for_incident(uuid)',
    'public.reverse_recent_disconnects()',
    'public.dismiss_violation_event(uuid,uuid,boolean,text)'
  ];
begin
  foreach f in array service_functions loop
    assert not has_function_privilege('anon', f, 'EXECUTE'),
      '16a: anon function access leaked on ' || f;
    assert not has_function_privilege('authenticated', f, 'EXECUTE'),
      '16a: authenticated function access leaked on ' || f;
    assert has_function_privilege('service_role', f, 'EXECUTE'),
      '16a: service_role lacks function access on ' || f;
  end loop;

  assert not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'idx_attempts_in_progress_last_seen'
  ), '16b: the high-churn attempts.last_seen_at index must not exist';
  assert (
    select count(*) = 3 from pg_indexes
     where schemaname = 'public'
       and indexname = any(array[
         'idx_violation_disconnect_timeline',
         'idx_violation_unresolved_disconnects',
         'idx_violation_recent_attention'
       ])
  ), '16b: all three low-churn proctoring indexes must exist';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_admin,
    'authenticated', 'authenticated', v_admin::text || '@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', ''
  );
  insert into public.admin_profiles (id, name, role)
  values (v_admin, 'Synthetic Smoke Admin', 'admin');

  insert into public.candidates (id, mer_code, full_name, nic_hash)
  values (v_candidate, 'TEST-PROCTOR-007', 'Synthetic Proctor Candidate', 'synthetic-hash');
  insert into public.exams (id, title, duration_min, status, started_at, ends_at)
  values (
    v_exam, 'Proctoring smoke', 30, 'live',
    now() - interval '10 minutes', now() + interval '20 minutes'
  );
  insert into public.exam_candidates (exam_id, candidate_id)
  values (v_exam, v_candidate);
  select id into v_attempt from public.attempts
   where exam_id = v_exam and candidate_id = v_candidate;
  insert into public.sessions (id, candidate_id, attempt_id)
  values (v_session, v_candidate, v_attempt);

  select out_result into v_result
    from public.candidate_heartbeat(gen_random_uuid());
  assert v_result = 'unauthenticated',
    '16c: an unknown heartbeat session must return unauthenticated';
  update public.sessions set revoked_at = now() where id = v_session;
  select out_result into v_result from public.candidate_heartbeat(v_session);
  assert v_result = 'session_revoked',
    '16c: a revoked heartbeat session must return session_revoked';
  update public.sessions set revoked_at = null where id = v_session;

  select out_result into v_result from public.record_candidate_event(
    v_session, v_event, 'TAB_HIDDEN', array[]::text[], 0, 1500, null, false
  );
  assert v_result = 'ignored', '16c: not-started attempts must ignore incidents';

  update public.attempts
     set status = 'acknowledged', acknowledged_at = now(), last_seen_at = now()
   where id = v_attempt;
  v_event := gen_random_uuid();
  select out_result, out_counts into v_result, v_counts
    from public.record_candidate_event(
      v_session, v_event, 'TAB_HIDDEN', array['FOCUS_LOST'], 0, 1500, null, false
    );
  assert v_result = 'inserted' and not v_counts,
    '16d: waiting-room incidents must not count';
  v_event := gen_random_uuid();
  select out_result into v_result from public.record_candidate_event(
    v_session, v_event, 'COPY', array[]::text[], 0, null, '[]'::jsonb, false
  );
  assert v_result = 'validation_failed',
    '16d: event meta must be a JSON object';
  v_before := (select violation_count from public.attempts where id = v_attempt);
  v_event := public.record_login_violation(
    v_attempt, 'MULTI_LOGIN', jsonb_build_object('source', 'login')
  );
  assert v_event is not null
     and (select not counts from public.violation_events where id = v_event)
     and (select violation_count from public.attempts where id = v_attempt) = v_before,
    '16d: waiting-room multi-login must be logged without counting';

  update public.attempts
     set status = 'in_progress', joined_at = now() - interval '5 minutes',
         last_seen_at = now()
   where id = v_attempt;
  v_event := gen_random_uuid();
  select out_result, out_counts, out_snapshot_path
    into v_result, v_counts, v_snapshot
    from public.record_candidate_event(
      v_session, v_event, 'FULLSCREEN_EXIT', array['FOCUS_LOST'], 500, 2500,
      jsonb_build_object('source', 'browser'), true
    );
  assert v_result = 'inserted' and v_counts and v_snapshot is not null,
    '16e: an in-exam incident must count and reserve a snapshot path';
  assert v_snapshot = format('snapshots/%s/%s/%s.jpg', v_exam, v_attempt, v_event),
    '16e: snapshot path must use server-owned ids';
  v_before := (select violation_count from public.attempts where id = v_attempt);
  select out_result into v_result from public.record_candidate_event(
    v_session, v_event, 'FULLSCREEN_EXIT', array['FOCUS_LOST'], 500, 2500,
    jsonb_build_object('source', 'browser'), true
  );
  assert v_result = 'duplicate'
     and (select violation_count from public.attempts where id = v_attempt) = v_before,
    '16f: retrying an event id must not double-count';

  assert public.mark_violation_snapshot_failed(v_event),
    '16g: snapshot failure marker must find the event';
  assert (select snapshot_path is null and meta->>'snapshot_error' = 'true'
            from public.violation_events where id = v_event),
    '16g: failed snapshot must clear its path and retain the event';

  v_event := gen_random_uuid();
  select out_result, out_counts, out_snapshot_path into v_result, v_counts, v_snapshot
    from public.record_candidate_event(
      v_session, v_event, 'CAMERA_LOST', array[]::text[], 0, 6000,
      jsonb_build_object('source', 'livekit'), true
    );
  assert v_result = 'inserted' and not v_counts and v_snapshot is null,
    '16h: LiveKit-only media loss must not count or reserve a snapshot';
  v_event := gen_random_uuid();
  select out_result, out_counts into v_result, v_counts
    from public.record_candidate_event(
      v_session, v_event, 'MIC_LOST', array[]::text[], 0, 6000, null, false
    );
  assert v_result = 'inserted' and not v_counts,
    '16h: media loss without a track source must not count';

  update public.attempts set last_seen_at = now() - interval '45 seconds'
   where id = v_attempt;
  perform public.record_disconnects();
  assert (select count(*) = 1 from public.violation_events
           where attempt_id = v_attempt and type = 'DISCONNECTED'),
    '16i: Pass 1 must insert one disconnect after 30 seconds';
  perform public.record_disconnects();
  assert (select count(*) = 1 from public.violation_events
           where attempt_id = v_attempt and type = 'DISCONNECTED'),
    '16i: Pass 1 must not duplicate an open disconnect';
  select id into v_disconnect from public.violation_events
   where attempt_id = v_attempt and type = 'DISCONNECTED'
   order by occurred_at desc, id desc limit 1;

  select out_result, out_state into v_result, v_state
    from public.candidate_heartbeat(v_session);
  assert v_result = 'ok' and v_state->>'phase' = 'live',
    '16j: heartbeat must return the candidate state body';
  assert (select meta->>'count_reason' from public.violation_events where id = v_disconnect) = 'short_gap',
    '16j: heartbeat must close a short disconnect without counting it';

  update public.violation_events
     set occurred_at = now() - interval '10 minutes', duration_ms = 1000
   where attempt_id = v_attempt
     and type in ('TAB_HIDDEN', 'FOCUS_LOST', 'FULLSCREEN_EXIT', 'VIEWPORT_CHANGED');
  update public.attempts set last_seen_at = now() - interval '3 minutes'
   where id = v_attempt;
  perform public.record_disconnects();
  select id into v_disconnect from public.violation_events
   where attempt_id = v_attempt and type = 'DISCONNECTED'
   order by occurred_at desc, id desc limit 1;
  assert (select meta->>'count_reason' is null from public.violation_events where id = v_disconnect),
    '16k: Pass 1 must open a later disconnect after reconnect';
  select out_result into v_result from public.candidate_heartbeat(v_session);
  assert v_result = 'ok',
    '16k: heartbeat after a long gap must still return state';
  assert (select counts and meta->>'count_reason' = 'long_gap'
            from public.violation_events where id = v_disconnect),
    '16k: heartbeat must count a clean gap at or above two minutes';

  v_event := gen_random_uuid();
  select out_result into v_result from public.record_candidate_event(
    v_session, v_event, 'FOCUS_LOST', array[]::text[], 120000, 10000, null, false
  );
  assert v_result = 'inserted'
     and (select not counts and meta->>'count_reason' = 'reversed_by_focus'
            from public.violation_events where id = v_disconnect),
    '16l: a late overlapping focus incident must reverse the disconnect count';

  insert into public.candidates (id, mer_code, full_name, nic_hash)
  values (
    v_submitted_candidate, 'TEST-PROCTOR-SUBMITTED',
    'Synthetic Submitted Candidate', 'synthetic-hash'
  );
  insert into public.exam_candidates (exam_id, candidate_id)
  values (v_exam, v_submitted_candidate);
  select id into v_submitted_attempt from public.attempts
   where exam_id = v_exam and candidate_id = v_submitted_candidate;
  update public.attempts
     set status = 'submitted', submit_reason = 'auto', submitted_at = now(),
         last_seen_at = now() - interval '5 minutes'
   where id = v_submitted_attempt;
  perform public.record_disconnects();
  assert not exists (
    select 1 from public.violation_events
     where attempt_id = v_submitted_attempt and type = 'DISCONNECTED'
  ), '16m: Pass 1 must not create disconnects for submitted attempts';

  v_audit_before := (select count(*) from public.admin_actions where admin_id = v_admin);
  insert into public.violation_events (attempt_id, type, counts, meta)
  values (v_attempt, 'RELOAD', true, null)
  returning id into v_review_event;
  v_before := (select violation_count from public.attempts where id = v_attempt);
  select out_result, out_counts into v_result, v_counts
    from public.dismiss_violation_event(
      v_review_event, v_admin, true, 'Synthetic false positive'
    );
  assert v_result = 'updated' and not v_counts
     and (select not counts and meta->'dismissed'->>'note' = 'Synthetic false positive'
            from public.violation_events where id = v_review_event)
     and (select violation_count from public.attempts where id = v_attempt) = v_before - 1,
    '16n: dismiss must handle null meta and decrement the badge';
  select out_result, out_counts into v_result, v_counts
    from public.dismiss_violation_event(
      v_review_event, v_admin, false, 'Synthetic restore'
    );
  assert v_result = 'updated' and v_counts
     and (select counts and not (meta ? 'dismissed')
            from public.violation_events where id = v_review_event)
     and (select violation_count from public.attempts where id = v_attempt) = v_before,
    '16n: restore must remove dismissed metadata and restore the badge';

  insert into public.violation_events (
    attempt_id, type, counts, occurred_at, meta
  ) values (
    v_attempt, 'DISCONNECTED', true, now() - interval '2 minutes',
    jsonb_build_object(
      'last_seen_at', (now() - interval '3 minutes')::timestamptz::text,
      'count_reason', 'long_gap'
    )
  ) returning id into v_review_disconnect;
  insert into public.violation_events (
    attempt_id, type, counts, occurred_at, duration_ms
  ) values (
    v_attempt, 'FOCUS_LOST', true, now() - interval '90 seconds', 10000
  ) returning id into v_review_focus;
  select out_result into v_result from public.dismiss_violation_event(
    v_review_disconnect, v_admin, true, 'Synthetic dismissed disconnect'
  );
  assert v_result = 'updated'
     and public.reverse_disconnects_for_incident(v_review_focus) = 0
     and (select not counts
                  and meta->>'count_reason' = 'dismissed'
                  and meta ? 'dismissed'
            from public.violation_events where id = v_review_disconnect),
    '16o: reversal must not change an admin-dismissed disconnect';
  select out_result into v_result from public.dismiss_violation_event(
    v_review_disconnect, v_admin, false, 'Synthetic restored disconnect'
  );
  assert v_result = 'updated'
     and public.reverse_disconnects_for_incident(v_review_focus) = 0
     and (select counts
                  and meta->>'count_reason' = 'restored'
                  and not (meta ? 'dismissed')
            from public.violation_events where id = v_review_disconnect),
    '16o: reversal must not change an admin-restored disconnect';
  assert (select count(*) from public.admin_actions where admin_id = v_admin)
           = v_audit_before + 4,
    '16o: dismiss and restore must each write an admin audit row';

  for i in 1..60 loop
    insert into public.violation_events (
      attempt_id, type, counts, occurred_at, snapshot_path
    ) values (
      v_attempt, 'COPY', false, now() - interval '2 minutes',
      format('snapshots/%s/%s/reserved-%s.jpg', v_exam, v_attempt, i)
    );
  end loop;
  v_event := gen_random_uuid();
  select out_result, out_snapshot_path into v_result, v_snapshot
    from public.record_candidate_event(
      v_session, v_event, 'MULTI_SCREEN', array[]::text[], 0, null, null, true
    );
  assert v_result = 'inserted' and v_snapshot is null
     and (select meta->>'snapshot_skipped' from public.violation_events where id = v_event) = 'limit',
    '16p: the 61st snapshot request must keep the event but skip the image';

  for i in 1..30 loop
    insert into public.violation_events (attempt_id, type, counts)
    values (v_attempt, 'COPY', false);
  end loop;
  v_event := gen_random_uuid();
  select out_result into v_result from public.record_candidate_event(
    v_session, v_event, 'COPY', array[]::text[], 0, null, null, false
  );
  assert v_result = 'rate_limited',
    '16q: the 31st client event inside 60 seconds must be rate limited';

  v_before := (select violation_count from public.attempts where id = v_attempt);
  assert public.record_login_violation(
           v_attempt, 'MULTI_LOGIN', jsonb_build_object('source', 'login')
         ) is not null
     and (select violation_count from public.attempts where id = v_attempt) = v_before + 1,
    '16r: a second login must create one counted MULTI_LOGIN event';

  select out_result into v_result from public.dismiss_violation_event(
    v_event, gen_random_uuid(), true, 'Synthetic review'
  );
  assert v_result = 'forbidden',
    '16s: dismiss RPC must reject an id without an admin profile';

  update public.attempts
     set status = 'submitted', submit_reason = 'manual', submitted_at = now()
   where id = v_attempt;
  v_event := gen_random_uuid();
  select out_result into v_result from public.record_candidate_event(
    v_session, v_event, 'RELOAD', array[]::text[], 0, null, null, false
  );
  assert v_result = 'ignored',
    '16t: submitted attempts must ignore late client incidents';
end $$;

select
  'SMOKE TEST PASSED' as result,
  current_setting('app.smoke_generate_paper_ms')::numeric as generate_paper_100_question_ms;

rollback;
