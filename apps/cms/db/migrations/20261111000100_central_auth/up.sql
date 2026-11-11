ALTER TABLE users ADD COLUMN auth_subject TEXT;
CREATE UNIQUE INDEX users_auth_subject_unique ON users(auth_subject) WHERE auth_subject IS NOT NULL;
ALTER TABLE sessions ADD COLUMN auth_subject TEXT;
