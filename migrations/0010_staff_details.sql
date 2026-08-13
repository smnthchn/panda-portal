-- Staff records: the details a boss keeps about a person, beyond the
-- sign-in identity and role that Users & Roles already covers.

ALTER TABLE employees ADD COLUMN phone TEXT;
ALTER TABLE employees ADD COLUMN started_on TEXT;
ALTER TABLE employees ADD COLUMN notes TEXT;
