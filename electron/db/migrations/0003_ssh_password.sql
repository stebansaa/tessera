-- SSH password storage. The cleartext password never lives in SQLite —
-- this column holds the bytes returned by Electron's safeStorage.encryptString,
-- which uses Keychain on macOS, DPAPI on Windows, and libsecret on Linux.
-- NULL means "no password set" (the user is using key auth, the agent, or
-- has not yet entered a password).
ALTER TABLE terminal_sessions ADD COLUMN password_enc BLOB;
