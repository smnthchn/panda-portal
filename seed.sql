-- Starting people for a fresh database. Run after the migrations.
-- Roles: boss | staff | volunteer. Per-person visibility exceptions live in
-- employee_permission_overrides and are managed from the Users & Roles page.

INSERT INTO employees (email, full_name, role, is_active, google_drive_folder_id)
VALUES
('samantha@pandahobby.ca', 'Samantha Cheng', 'boss', 1, '1qex51OdZwnePtC61ng40RE8DzednfM-z'),
('baldwin@pandahobby.ca', 'Baldwin Cheng', 'boss', 1, '1zRke8Put_0cZKIqJnAnFq1HCzZtTdVmY'),
('chan.samantha89@gmail.com', 'Test Staff', 'staff', 1, '1rQVDtO0GUe5YYYC7FhbPXeIQ4jfHP-ZO');

INSERT INTO knowledge_base_sections (name, slug, folder_id, allowed_role, sort_order, is_active)
VALUES
('Retail SOPs', 'retail-sops', '1FuCoxH9YHUQePCVdSln0x4L1hwx0qqaB', 'staff', 1, 1),
('Manager Only', 'manager-only', '1tMbctWEgskXc_j5nq4jd-0CRllhrH9NQ', 'boss', 2, 1);
