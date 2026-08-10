UPDATE employees
SET
  full_name = 'Baldwin Cheng',
  role = 'manager',
  is_active = 1,
  can_access_portal = 1,
  can_view_knowledge_base = 1,
  can_view_employee_folder = 1,
  can_use_clock = 1,
  google_drive_folder_id = '1zRke8Put_0cZKIqJnAnFq1HCzZtTdVmY'
WHERE email = 'baldwin@pandahobby.ca';

UPDATE employees
SET
  full_name = 'Samantha Cheng',
  role = 'admin',
  google_drive_folder_id = '1qex51OdZwnePtC61ng40RE8DzednfM-z'
WHERE email = 'samantha@pandahobby.ca';

UPDATE knowledge_base_sections
SET folder_id = '1FuCoxH9YHUQePCVdSln0x4L1hwx0qqaB'
WHERE slug = 'retail-sops';

UPDATE knowledge_base_sections
SET folder_id = '1tMbctWEgskXc_j5nq4jd-0CRllhrH9NQ'
WHERE slug = 'manager-only';