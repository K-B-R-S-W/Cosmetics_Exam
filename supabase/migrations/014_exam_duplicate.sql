-- =====================================================================
-- 014_exam_duplicate.sql - atomic exam-definition duplication.
-- Run after 013_snapshot_retention.sql. Storage images are copied by the
-- server after this transaction; copied questions start without images.
-- =====================================================================

begin;

create function public.duplicate_exam(
  p_exam_id uuid,
  p_created_by uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_source_exam public.exams%rowtype;
  v_source_question public.questions%rowtype;
  v_source_option public.mcq_options%rowtype;
  v_source_key public.answer_keys%rowtype;
  v_new_exam_id uuid;
  v_new_question_id uuid;
  v_new_option_id uuid;
  v_new_correct_option_id uuid;
  v_has_key boolean;
  v_extension text;
  v_destination_path text;
  v_image_mappings jsonb := '[]'::jsonb;
begin
  select e.*
    into v_source_exam
    from public.exams e
   where e.id = p_exam_id
   for share;

  if not found then
    raise exception 'exam_not_found';
  end if;

  if not exists (
    select 1
      from public.admin_profiles ap
     where ap.id = p_created_by
  ) then
    raise exception 'admin_not_found';
  end if;

  insert into public.exams (
    title, instructions, scheduled_start_at, started_at, ends_at,
    force_ended_at, duration_min, status, navigation_mode, shuffle,
    flag_threshold, is_practice, created_by
  ) values (
    left('Copy of ' || v_source_exam.title, 150),
    v_source_exam.instructions,
    null,
    null,
    null,
    null,
    v_source_exam.duration_min,
    'draft',
    v_source_exam.navigation_mode,
    v_source_exam.shuffle,
    v_source_exam.flag_threshold,
    v_source_exam.is_practice,
    p_created_by
  )
  returning id into v_new_exam_id;

  for v_source_question in
    select q.*
      from public.questions q
     where q.exam_id = p_exam_id
     order by q.position, q.id
  loop
    v_new_question_id := gen_random_uuid();
    v_new_correct_option_id := null;

    select ak.*
      into v_source_key
      from public.answer_keys ak
     where ak.question_id = v_source_question.id;
    v_has_key := found;

    insert into public.questions (
      id, exam_id, position, type, body_html, image_path,
      image_alt_text, image_mime, image_size_bytes, marks
    ) values (
      v_new_question_id,
      v_new_exam_id,
      v_source_question.position,
      v_source_question.type,
      v_source_question.body_html,
      null,
      null,
      null,
      null,
      v_source_question.marks
    );

    for v_source_option in
      select o.*
        from public.mcq_options o
       where o.question_id = v_source_question.id
       order by o.position, o.id
    loop
      v_new_option_id := gen_random_uuid();

      insert into public.mcq_options (
        id, question_id, position, label, text_html
      ) values (
        v_new_option_id,
        v_new_question_id,
        v_source_option.position,
        v_source_option.label,
        v_source_option.text_html
      );

      if v_has_key
         and v_source_key.correct_option_id = v_source_option.id then
        v_new_correct_option_id := v_new_option_id;
      end if;
    end loop;

    if v_has_key then
      insert into public.answer_keys (
        question_id, correct_option_id, model_answer,
        grading_notes, calibration
      ) values (
        v_new_question_id,
        v_new_correct_option_id,
        v_source_key.model_answer,
        v_source_key.grading_notes,
        v_source_key.calibration
      );
    end if;

    if v_source_question.image_path is not null then
      v_extension := case v_source_question.image_mime
        when 'image/jpeg' then 'jpg'
        when 'image/png' then 'png'
        when 'image/webp' then 'webp'
        else null
      end;

      if v_extension is null then
        raise exception 'invalid_question_image_metadata';
      end if;

      v_destination_path := format(
        'questions/%s/%s.%s',
        p_created_by,
        v_new_question_id,
        v_extension
      );
      v_image_mappings := v_image_mappings || jsonb_build_array(
        jsonb_build_object(
          'source_question_id', v_source_question.id,
          'question_id', v_new_question_id,
          'source_path', v_source_question.image_path,
          'destination_path', v_destination_path,
          'alt_text', v_source_question.image_alt_text,
          'mime', v_source_question.image_mime,
          'size_bytes', v_source_question.image_size_bytes
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'exam_id', v_new_exam_id,
    'images', v_image_mappings
  );
end;
$$;

revoke execute on function public.duplicate_exam(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.duplicate_exam(uuid, uuid) to service_role;

commit;
