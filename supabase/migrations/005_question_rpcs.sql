begin;

-- Save a complete question atomically. The exam row lock prevents the status
-- changing while the question, options and key are written. Client-generated
-- question/option ids make the same request safe to retry.
create or replace function public.save_question(
  p_question_id uuid,
  p_exam_id uuid,
  p_type text,
  p_body_html text,
  p_marks numeric,
  p_position int,
  p_image_path text,
  p_image_alt_text text,
  p_image_mime text,
  p_image_size_bytes int,
  p_options jsonb,
  p_correct_option_id uuid,
  p_model_answer text,
  p_grading_notes text,
  p_calibration jsonb
)
returns table (out_question_id uuid, out_position int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_status text;
  v_existing_exam uuid;
  v_existing_type text;
  v_position int;
  v_options_written int;
  v_options jsonb := coalesce(p_options, '[]'::jsonb);
begin
  select e.status into v_exam_status
    from public.exams e
   where e.id = p_exam_id
   for share;

  if not found then raise exception 'exam_not_found'; end if;
  if v_exam_status not in ('draft', 'scheduled') then raise exception 'exam_locked'; end if;
  if p_type not in ('mcq', 'written') then raise exception 'validation_failed'; end if;
  if p_question_id is null or p_body_html is null or btrim(p_body_html) = '' then
    raise exception 'validation_failed';
  end if;
  if coalesce(p_marks, 1) <= 0 or coalesce(p_marks, 1) > 999.99 then
    raise exception 'validation_failed';
  end if;
  if jsonb_typeof(v_options) <> 'array' then raise exception 'validation_failed'; end if;

  select q.exam_id, q.type, q.position
    into v_existing_exam, v_existing_type, v_position
    from public.questions q
   where q.id = p_question_id;

  if found then
    if v_existing_exam <> p_exam_id then raise exception 'not_found'; end if;
    if v_existing_type <> p_type then raise exception 'type_immutable'; end if;
  else
    if p_position is not null and p_position < 0 then raise exception 'validation_failed'; end if;
    select coalesce(p_position, coalesce(max(q.position) + 1, 0))
      into v_position
      from public.questions q
     where q.exam_id = p_exam_id;
  end if;

  insert into public.questions (
    id, exam_id, position, type, body_html,
    image_path, image_alt_text, image_mime, image_size_bytes, marks
  ) values (
    p_question_id, p_exam_id, v_position, p_type, p_body_html,
    p_image_path, p_image_alt_text, p_image_mime, p_image_size_bytes,
    coalesce(p_marks, 1)
  )
  on conflict (id) do update
     set body_html = excluded.body_html,
         image_path = excluded.image_path,
         image_alt_text = excluded.image_alt_text,
         image_mime = excluded.image_mime,
         image_size_bytes = excluded.image_size_bytes,
         marks = excluded.marks
   where questions.exam_id = p_exam_id
     and questions.type = p_type
  returning questions.position into v_position;

  if not found then
    select q.exam_id, q.type into v_existing_exam, v_existing_type
      from public.questions q
     where q.id = p_question_id;
    if v_existing_exam <> p_exam_id then raise exception 'not_found'; end if;
    if v_existing_type <> p_type then raise exception 'type_immutable'; end if;
    raise exception 'validation_failed';
  end if;

  if p_type = 'mcq' then
    if jsonb_array_length(v_options) not between 2 and 10 then
      raise exception 'validation_failed';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(v_options) item
       where item->>'id' is null
          or item->>'text_html' is null
          or btrim(item->>'text_html') = ''
    ) then
      raise exception 'validation_failed';
    end if;
    if exists (
      select 1
        from public.mcq_options existing
        join jsonb_array_elements(v_options) item
          on existing.id = (item->>'id')::uuid
       where existing.question_id <> p_question_id
    ) then
      raise exception 'not_found';
    end if;

    begin
      insert into public.mcq_options (id, question_id, position, label, text_html)
      select
        (item.value->>'id')::uuid,
        p_question_id,
        (item.ordinality - 1)::int,
        chr(96 + item.ordinality::int),
        item.value->>'text_html'
        from jsonb_array_elements(v_options) with ordinality as item(value, ordinality)
      on conflict (id) do update
         set position = excluded.position,
             label = excluded.label,
             text_html = excluded.text_html
       where mcq_options.question_id = p_question_id;
      get diagnostics v_options_written = row_count;
    exception when cardinality_violation then
      raise exception 'validation_failed';
    end;
    if v_options_written <> jsonb_array_length(v_options) then
      raise exception 'not_found';
    end if;

    delete from public.mcq_options existing
     where existing.question_id = p_question_id
       and not exists (
         select 1
           from jsonb_array_elements(v_options) item
          where (item->>'id')::uuid = existing.id
       );

    if p_correct_option_id is null or not exists (
      select 1
        from public.mcq_options option_row
       where option_row.id = p_correct_option_id
         and option_row.question_id = p_question_id
    ) then
      raise exception 'bad_correct_option';
    end if;
    if p_model_answer is not null or p_grading_notes is not null
       or coalesce(p_calibration, '[]'::jsonb) <> '[]'::jsonb then
      raise exception 'type_mismatch';
    end if;

    insert into public.answer_keys (
      question_id, correct_option_id, model_answer, grading_notes, calibration
    ) values (
      p_question_id, p_correct_option_id, null, null, null
    )
    on conflict (question_id) do update
       set correct_option_id = excluded.correct_option_id,
           model_answer = null,
           grading_notes = null,
           calibration = null;
  else
    if jsonb_array_length(v_options) <> 0 or p_correct_option_id is not null then
      raise exception 'type_mismatch';
    end if;

    delete from public.mcq_options where question_id = p_question_id;

    insert into public.answer_keys (
      question_id, correct_option_id, model_answer, grading_notes, calibration
    ) values (
      p_question_id, null, p_model_answer, p_grading_notes,
      coalesce(p_calibration, '[]'::jsonb)
    )
    on conflict (question_id) do update
       set correct_option_id = null,
           model_answer = excluded.model_answer,
           grading_notes = excluded.grading_notes,
           calibration = excluded.calibration;
  end if;

  return query select p_question_id, v_position;
end $$;

create or replace function public.delete_question(
  p_exam_id uuid,
  p_question_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_status text;
begin
  select e.status into v_exam_status
    from public.exams e
   where e.id = p_exam_id
   for share;

  if not found then raise exception 'exam_not_found'; end if;
  if v_exam_status not in ('draft', 'scheduled') then raise exception 'exam_locked'; end if;

  delete from public.questions q
   where q.id = p_question_id
     and q.exam_id = p_exam_id;
  if not found then raise exception 'not_found'; end if;

  return true;
end $$;

create or replace function public.reorder_questions(
  p_exam_id uuid,
  p_ordered_ids uuid[]
)
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_status text;
  v_ordered_ids uuid[] := coalesce(p_ordered_ids, array[]::uuid[]);
  v_updated int;
begin
  select e.status into v_exam_status
    from public.exams e
   where e.id = p_exam_id
   for share;

  if not found then raise exception 'exam_not_found'; end if;
  if v_exam_status not in ('draft', 'scheduled') then raise exception 'exam_locked'; end if;
  if exists (select 1 from unnest(v_ordered_ids) item(id) where item.id is null) then
    raise exception 'validation_failed';
  end if;
  if cardinality(v_ordered_ids) <> (
    select count(distinct item.id) from unnest(v_ordered_ids) item(id)
  ) then
    raise exception 'validation_failed';
  end if;
  if cardinality(v_ordered_ids) <> (
    select count(*) from public.questions q where q.exam_id = p_exam_id
  ) or exists (
    select 1
      from unnest(v_ordered_ids) item(id)
     where not exists (
       select 1 from public.questions q
        where q.id = item.id and q.exam_id = p_exam_id
     )
  ) then
    raise exception 'validation_failed';
  end if;

  update public.questions q
     set position = (ordered.ordinality - 1)::int
    from unnest(v_ordered_ids) with ordinality as ordered(id, ordinality)
   where q.id = ordered.id
     and q.exam_id = p_exam_id;
  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(v_ordered_ids) then
    raise exception 'validation_failed';
  end if;

  return v_updated;
end $$;

create or replace function public.save_answer_key(
  p_question_id uuid,
  p_correct_option_id uuid,
  p_model_answer text,
  p_grading_notes text,
  p_calibration jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_id uuid;
  v_question_type text;
  v_regrade_needed boolean;
begin
  select q.exam_id, q.type
    into v_exam_id, v_question_type
    from public.questions q
    join public.exams e on e.id = q.exam_id
   where q.id = p_question_id
   for share of e, q;

  if not found then raise exception 'not_found'; end if;
  if exists (
    select 1
      from public.grading_runs run
     where run.exam_id = v_exam_id
       and run.status in ('running', 'paused')
  ) then
    raise exception 'grading_in_progress';
  end if;

  if v_question_type = 'mcq' then
    if p_correct_option_id is null or not exists (
      select 1
        from public.mcq_options option_row
       where option_row.id = p_correct_option_id
         and option_row.question_id = p_question_id
    ) then
      raise exception 'bad_correct_option';
    end if;
    if p_model_answer is not null or p_grading_notes is not null
       or coalesce(p_calibration, '[]'::jsonb) <> '[]'::jsonb then
      raise exception 'type_mismatch';
    end if;

    insert into public.answer_keys (
      question_id, correct_option_id, model_answer, grading_notes, calibration
    ) values (
      p_question_id, p_correct_option_id, null, null, null
    )
    on conflict (question_id) do update
       set correct_option_id = excluded.correct_option_id,
           model_answer = null,
           grading_notes = null,
           calibration = null;
  else
    if p_correct_option_id is not null then raise exception 'type_mismatch'; end if;

    insert into public.answer_keys (
      question_id, correct_option_id, model_answer, grading_notes, calibration
    ) values (
      p_question_id, null, p_model_answer, p_grading_notes,
      coalesce(p_calibration, '[]'::jsonb)
    )
    on conflict (question_id) do update
       set correct_option_id = null,
           model_answer = excluded.model_answer,
           grading_notes = excluded.grading_notes,
           calibration = excluded.calibration;
  end if;

  select exists (
    select 1 from public.question_scores score where score.question_id = p_question_id
  ) into v_regrade_needed;
  return v_regrade_needed;
end $$;

revoke execute on function public.save_question(
  uuid, uuid, text, text, numeric, integer, text, text, text, integer,
  jsonb, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.save_question(
  uuid, uuid, text, text, numeric, integer, text, text, text, integer,
  jsonb, uuid, text, text, jsonb
) to service_role;

revoke execute on function public.delete_question(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_question(uuid, uuid) to service_role;

revoke execute on function public.reorder_questions(uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.reorder_questions(uuid, uuid[]) to service_role;

revoke execute on function public.save_answer_key(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_answer_key(uuid, uuid, text, text, jsonb)
  to service_role;

commit;
