"""A throwaway Postgres schema per test process -- and cleaning up after itself.

Imported by test modules BEFORE the first database access, only for the
side effect: to set NICHE_DB_SCHEMA and register the schema's removal
on process exit.

The schema's owner is the process, not the module: under pytest several test files
live in one process, and the second import sees NICHE_DB_SCHEMA already set.
So the decision "is the schema ours" is made once here (the module
is imported once), and the DROP is done in atexit -- after
all modules have run, not in the teardown of the first of them.

Under pytest the tests themselves do not run in the process schema but each file in its own:
tests/conftest.py wraps the module that imported schema_scope in
module_schema() -- a fresh empty schema for the duration of this file's tests, dropped
after them. This way `pytest tests/` in one process sees the database the same way as a run
with one file per process: foreign rows from neighbouring files do not interfere.

Two schemas are never dropped:
  * one set from outside via NICHE_DB_SCHEMA -- it may hold real data
    (then module_schema() substitutes nothing either: all files work in it);
  * our own, if NICHE_KEEP_TEST_SCHEMA=1 is set -- to investigate a failure
    (the schema name is printed on exit).
"""
import atexit
import contextlib
import itertools
import os
import uuid

OWN_SCHEMA = os.environ.get("NICHE_DB_SCHEMA") is None
if OWN_SCHEMA:
    os.environ["NICHE_DB_SCHEMA"] = f"nichetest_{uuid.uuid4().hex[:8]}"
SCHEMA = os.environ["NICHE_DB_SCHEMA"]

_module_seq = itertools.count(1)

# TestClient sends Host: testserver, while the HTTP API answers only local names
# (interfaces/http/api.py, local_only_guard). We allow it explicitly through the same
# setting a user has -- before importing api, which reads it once.
_extra_hosts = os.environ.get("NF_ALLOWED_HOSTS", "")
if "testserver" not in _extra_hosts.split(","):
    os.environ["NF_ALLOWED_HOSTS"] = ",".join(filter(None, [_extra_hosts, "testserver"]))


def _drop(schema):
    if os.environ.get("NICHE_KEEP_TEST_SCHEMA"):
        print(f"test schema kept: NICHE_DB_SCHEMA={schema}")
        return
    import infrastructure.postgres as db
    conn = db.get_conn()
    try:
        conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        conn.commit()
    finally:
        conn.close()


def drop_own_schema():
    """Drop the schema created by this process. Idempotent."""
    if not OWN_SCHEMA:
        return
    _drop(SCHEMA)


def _vector_extension_to_public():
    """The vector extension lives in public, not in some file's schema.

    init_db() creates it in the current schema: the first init_db happens already on
    importing api.py, in the process or file schema. From there the vector type is not visible from the
    search_path of the other files ("<own schema>, public"), and DROP SCHEMA ...
    CASCADE removes the extension together with the schema -- pgvector tests then silently
    go to skip. pgvector is relocatable, so what is already created is simply
    moved. No extension in the image -- we do nothing, the skip is honest."""
    import infrastructure.postgres as db
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace "
            "WHERE e.extname = 'vector'").fetchone()
        try:
            if row is None:
                conn.execute("CREATE EXTENSION IF NOT EXISTS vector SCHEMA public")
            elif row[0] != "public":
                conn.execute("ALTER EXTENSION vector SET SCHEMA public")
            conn.commit()
        except Exception:
            conn.rollback()
    finally:
        conn.close()


@contextlib.contextmanager
def module_schema():
    """A fresh schema of its own for the duration of one test module, then DROP.

    The schema is ready at once (init_db), as before in a separate process where
    importing api.py prepared it: otherwise a file that does not call init_db itself would read
    public silently via search_path -- locally that is real data.

    With a schema set from outside it does nothing: we do not replace it."""
    if not OWN_SCHEMA:
        yield SCHEMA
        return
    import infrastructure.postgres as db
    _vector_extension_to_public()
    previous = os.environ["NICHE_DB_SCHEMA"]
    schema = f"{SCHEMA}_m{next(_module_seq)}"
    os.environ["NICHE_DB_SCHEMA"] = schema
    try:
        db.init_db()
        yield schema
    finally:
        os.environ["NICHE_DB_SCHEMA"] = previous
        _drop(schema)


atexit.register(drop_own_schema)
