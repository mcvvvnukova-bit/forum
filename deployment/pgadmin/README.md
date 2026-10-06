# pgAdmin administrator connections

The production pgAdmin is installed in `/opt/pgadmin` and published at
https://pg.astforum.ru/browser/. This configuration targets the existing
pgAdmin 9.17 deployment and the existing `admin@astforum.ru` account.

`AST Forum / PostgreSQL (admin)` uses the existing PostgreSQL administrator
role `outline` for `forum`, `forum_sber_sandbox`, `outline`, and `postgres`.
Separate registrations reach OpenProject, Cal.diy, and Listmonk through their
existing internal Docker networks and database roles. The `forum_app`
registration shows only `forum`; its PostgreSQL restrictions remain intact.

The per-user `.pgpass` contains wildcard database entries for each internal
host, is owned by UID/GID 5050, and has mode 0600. Passwords are read from the
existing running database containers and their secret mounts; no credentials
belong in this directory or Git. Other pgAdmin users are not modified.

Server replacement at startup is disabled. The provisioning script updates
existing registrations in place so their IDs and new saved query tabs survive
container restarts. `servers.json` seeds a fresh installation; it does not
replace the registrations of an initialized installation.

To apply, copy these files to a restricted staging directory on the Forum
server, then run `sudo python3 /path/to/staging/configure-admin.py`.
The script validates the candidate Compose configuration, takes a private
SQLite/configuration/password-file backup under
`/opt/backups/pgadmin-admin-connections`, recreates only pgAdmin, and probes
each connectable database from its container. It does not change PostgreSQL
roles, HBA rules, schemas, or data. PostgreSQL ports remain unpublished and
pgAdmin port 5050 remains bound to loopback.

After applying, reload the browser, connect each server, and execute
`SELECT current_database(), current_user;` in the query tool. Repeat a pgAdmin
restart and confirm the registration IDs and browser queries still work.
Tabs already referencing deleted IDs must be reopened from the current tree.

Rollback: stop pgAdmin; restore `compose.yaml`, `servers.json`, `pgadmin4.db`,
and the administrator `.pgpass` from the printed backup directory; ensure the
SQLite file and `.pgpass` are owned by UID/GID 5050; start pgAdmin with Compose.
The backups contain credentials and must remain private.
