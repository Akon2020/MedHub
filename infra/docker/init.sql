-- The application role is deliberately not a superuser: superusers bypass Row Level Security.
-- Development password only; change it in .env.local and here if the port is exposed.
CREATE ROLE medhub_app LOGIN PASSWORD 'medhub_dev_password' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
CREATE DATABASE medhub_dev OWNER medhub_app;
CREATE DATABASE medhub_test OWNER medhub_app;
\connect medhub_dev
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
\connect medhub_test
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
