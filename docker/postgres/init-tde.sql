-- First start only (/docker-entrypoint-initdb.d): encrypts the whole cluster
-- with pg_tde. The keys are kept in /tde/keyring (a volume of its own):
-- without that file neither the data nor the WAL can be read, so back it up
-- apart from the database, and keep the two apart.

SET pg_tde.cipher = 'aes_256';
CREATE EXTENSION IF NOT EXISTS pg_tde;
SELECT pg_tde_add_global_key_provider_file('knowlective-keyring', '/tde/keyring');
-- Tables and indexes of every database.
SELECT pg_tde_create_key_using_global_key_provider('knowlective-default', 'knowlective-keyring');
SELECT pg_tde_set_default_key_using_global_key_provider('knowlective-default', 'knowlective-keyring');
-- The WAL.
SELECT pg_tde_create_key_using_global_key_provider('knowlective-wal', 'knowlective-keyring');
SELECT pg_tde_set_server_key_using_global_key_provider('knowlective-wal', 'knowlective-keyring');

ALTER SYSTEM SET pg_tde.cipher = 'aes_256';
-- New tables are encrypted, and an unencrypted one can't be made.
ALTER SYSTEM SET default_table_access_method = 'tde_heap';
ALTER SYSTEM SET pg_tde.enforce_encryption = on;
-- Takes effect when the image restarts the server after these scripts.
ALTER SYSTEM SET pg_tde.wal_encrypt = on;

-- Databases created later (Prisma's shadow database) get the extension,
-- which the tde_heap access method belongs to.
\connect template1
CREATE EXTENSION IF NOT EXISTS pg_tde;
