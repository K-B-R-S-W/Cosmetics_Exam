-- =====================================================================
-- 014_duplicate_smoke_test.sql - run AFTER migration 014 on development.
-- Everything runs inside a transaction that is ROLLED BACK.
-- Success = the final result-grid row says "014 DUPLICATE SMOKE TEST PASSED".
-- =====================================================================

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_candidate uuid := gen_random_uuid();
  v_exam uuid := gen_random_uuid();
  v_mcq uuid := gen_random_uuid();
  v_written uuid := gen_random_uuid();
  v_option_a uuid := gen_random_uuid();
  v_option_b uuid := gen_random_uuid();
  v_copy uuid;
  v_copy_mcq uuid;
  v_copy_correct uuid;
begin
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
  values (v_admin, 'Duplicate Smoke Admin', 'admin');

  insert into public.candidates (id, mer_code, full_name, nic_hash)
  values (v_candidate, 'DUPLICATE-014', 'Duplicate Smoke Candidate', 'synthetic-hash');
  insert into public.exams (
    id, title, instructions, scheduled_start_at, duration_min, status,
    navigation_mode, shuffle, flag_threshold, is_practice, created_by
  ) values (
    v_exam, repeat('X', 150), 'Synthetic duplicate instructions',
    clock_timestamp() + interval '1 day', 45, 'scheduled',
    'sequential', true, 7, true, v_admin
  );
  insert into public.exam_candidates (exam_id, candidate_id)
  values (v_exam, v_candidate);

  insert into public.questions (
    id, exam_id, position, type, body_html, marks
  ) values
    (v_mcq, v_exam, 0, 'mcq', '<p>MCQ duplicate smoke</p>', 2),
    (v_written, v_exam, 1, 'written', '<p>Written duplicate smoke</p>', 3);
  insert into public.mcq_options (id, question_id, position, label, text_html)
  values
    (v_option_a, v_mcq, 0, 'a', '<p>First</p>'),
    (v_option_b, v_mcq, 1, 'b', '<p>Second</p>');
  insert into public.answer_keys (
    question_id, correct_option_id, model_answer, grading_notes, calibration
  ) values
    (v_mcq, v_option_b, null, null, null),
    (v_written, null, 'Synthetic model answer', 'Synthetic grading notes',
      '[{"answer":"Example","marks":2,"note":"Synthetic"}]'::jsonb);

  select (public.duplicate_exam(v_exam, v_admin)->>'exam_id')::uuid
    into v_copy;

  assert (select status = 'draft' from public.exams where id = v_copy),
    '014a: duplicate must be draft';
  assert (select scheduled_start_at is null and started_at is null
                 and ends_at is null and force_ended_at is null
            from public.exams where id = v_copy),
    '014b: duplicate must reset every schedule and lifecycle timestamp';
  assert (select title = 'Copy of ' || repeat('X', 142)
                 and char_length(title) = 150
            from public.exams where id = v_copy),
    '014c: duplicate title must be prefixed and truncated to 150 characters';
  assert (select count(*) from public.questions where exam_id = v_copy) = 2,
    '014d: duplicate must copy every question';
  assert (select count(*)
            from public.mcq_options o
            join public.questions q on q.id = o.question_id
           where q.exam_id = v_copy) = 2,
    '014e: duplicate must copy every MCQ option';
  assert (select count(*)
            from public.answer_keys ak
            join public.questions q on q.id = ak.question_id
           where q.exam_id = v_copy) = 2,
    '014f: duplicate must copy every answer key';

  select q.id, ak.correct_option_id
    into v_copy_mcq, v_copy_correct
    from public.questions q
    join public.answer_keys ak on ak.question_id = q.id
   where q.exam_id = v_copy and q.type = 'mcq';
  assert v_copy_mcq <> v_mcq and v_copy_correct not in (v_option_a, v_option_b),
    '014g: duplicate must use new question and correct-option ids';
  assert exists (
    select 1 from public.mcq_options o
     where o.id = v_copy_correct and o.question_id = v_copy_mcq
  ), '014h: remapped correct option must belong to the copied MCQ';
  assert (select count(*) from public.exam_candidates where exam_id = v_copy) = 0,
    '014i: duplicate must not copy candidate assignments';
  assert (select count(*) from public.attempts where exam_id = v_copy) = 0,
    '014j: duplicate must not copy attempts';
end $$;

select '014 DUPLICATE SMOKE TEST PASSED' as result;

rollback;
