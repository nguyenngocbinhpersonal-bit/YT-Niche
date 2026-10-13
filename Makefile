# niche-finder -- common tasks
# Docker path is the default; `make local-*` targets run straight on the host.

COMPOSE ?= docker compose
IMAGE   ?= niche-finder:latest

# mcp[cli] (see backend/requirements.txt) needs Python 3.10+, but on macOS a
# bare `python3` often resolves to the Xcode Command Line Tools' Python 3.9 --
# that silently breaks `local-install` (pip aborts on the first requirement,
# so nothing after it gets installed either). Prefer a newer interpreter if one
# is on PATH; override explicitly with `make local-install PYTHON=python3.11`.
PYTHON  ?= $(shell command -v python3.13 || command -v python3.12 || \
             command -v python3.11 || command -v python3.10 || command -v python3)

RUFF_VERSION ?= 0.16.9
RUFF    ?= uvx ruff@$(RUFF_VERSION)

.PHONY: help doctor build up up-db web open down logs worker mcp http shell test seed stats clean local-install local-test lint frontend-test local-run dev cli api-docs extension-zip

doctor: ## check the key, network and database (start here)
	$(COMPOSE) run --rm mcp python cli.py doctor

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

build:  ## build the image (PREFETCH_MODEL=1 bakes in the embedding model)
	$(COMPOSE) build

up:     ## start the dashboard and the background collector
	$(COMPOSE) up -d web worker
	@echo "Dashboard: http://localhost:$${WEB_PORT:-8080}"

web:    ## the dashboard only
	$(COMPOSE) up -d web
	@echo "Dashboard: http://localhost:$${WEB_PORT:-8080}"

open:   ## open the dashboard in the browser
	open "http://localhost:$${WEB_PORT:-8080}"

down:   ## stop everything
	$(COMPOSE) down

logs:   ## logs of the collector and the dashboard
	$(COMPOSE) logs -f worker web

mcp:    ## run the MCP server on stdio (manual poke)
	$(COMPOSE) run --rm mcp

http:   ## expose the MCP server over HTTP on :8765
	$(COMPOSE) --profile http up -d mcp-http

shell:  ## shell inside the image, with the models volume mounted
	docker run --rm -it --network niche-finder_default -v niche-finder-models:/models $(IMAGE) bash

# The make_test schema is reused between runs, so we clean it BEFORE
# the run: otherwise data from the last time breaks tests that depend on a fresh
# discovered_at (make test was green only on the first run).
test:   ## run the smoke tests inside the image, against postgres (needs: make up-db)
	@$(COMPOSE) exec -T postgres sh -c \
	  'psql -q -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -c "DROP SCHEMA IF EXISTS make_test CASCADE"' >/dev/null
	docker run --rm --network niche-finder_default -e NICHE_DB_SCHEMA=make_test \
	  -e POSTGRES_HOST=postgres $(IMAGE) python tests/test_smoke.py

seed:   ## fill the database with synthetic demo data to try the tools (needs: make up-db)
	docker run --rm --network niche-finder_default -e POSTGRES_HOST=postgres \
	  $(IMAGE) python tests/seed_demo.py

stats:  ## what is in the database right now (needs: make up-db)
	docker run --rm --network niche-finder_default -e POSTGRES_HOST=postgres $(IMAGE) \
	  python -c "import json; from application import search as query; print(json.dumps(query.db_stats(), indent=2, default=str))"

up-db:  ## just the database, e.g. before make test/seed/stats
	$(COMPOSE) up -d postgres

cli:    ## an arbitrary CLI command:  make cli ARGS="viral --period 24h"
	$(COMPOSE) run --rm mcp python cli.py $(ARGS)

clean:  ## delete the Postgres data volume (irreversible)
	docker volume rm niche-finder-postgres-data

local-install:  ## venv + deps, without Docker (needs Python 3.10+, auto-detected -- see PYTHON above)
	@ver=$$($(PYTHON) -c 'import sys; print("%d.%d" % sys.version_info[:2])'); \
	  major=$$(echo $$ver | cut -d. -f1); minor=$$(echo $$ver | cut -d. -f2); \
	  if [ "$$major" -lt 3 ] || { [ "$$major" -eq 3 ] && [ "$$minor" -lt 10 ]; }; then \
	    echo "ERROR: $(PYTHON) -> Python $$ver, but the mcp package needs 3.10+."; \
	    echo "Install a modern Python (for example: brew install python@3.12) and retry,"; \
	    echo "or specify it explicitly:  make local-install PYTHON=python3.12"; \
	    exit 1; \
	  fi; \
	  echo "using $$($(PYTHON) --version) ($(PYTHON))"
	cd backend && $(PYTHON) -m venv .venv \
	  && ./.venv/bin/pip install --upgrade pip \
	  && ./.venv/bin/pip install -r requirements.txt pytest

# The tests deliberately do not read .env (they need neither a key nor the network),
# so NICHE_DATABASE_URL is pulled from .env here -- otherwise a host run
# goes to localhost:5432 and fails with Connection refused.
# As in CI: the whole tests/ in one pytest process. Isolation of files from each other
# is provided by tests/conftest.py -- Postgres tests get a fresh schema per file, and
# sqlite doubles live in a separate module world, not in sys.modules
# (tests/module_doubles.py). The exit code is pytest's.
local-test:     ## run all backend tests on the host in one pytest process
	@cd backend && export NICHE_DATABASE_URL="$${NICHE_DATABASE_URL:-$$(grep -E '^NICHE_DATABASE_URL=' ../.env 2>/dev/null | sed -E 's/^[^=]+=//; s/^"//; s/"$$//' | tr -d '\r')}"; \
	  ./.venv/bin/python -m pytest -q -p no:cacheprovider tests/

# The same ruff version as in CI (.github/workflows/ci.yml); the config is in
# backend/pyproject.toml. uvx (from uv) downloads ruff itself, it is not needed in .venv;
# without uv:  make lint RUFF=ruff  (ruff==$(RUFF_VERSION) from pip).
lint:           ## lint the backend with ruff (same pinned version as CI)
	$(RUFF) check backend

api-docs:       ## regenerate docs/http-api.md from the HTTP routes (CI checks it is current)
	python3 scripts/gen_http_api_docs.py

extension-zip:  ## pack extension/ into dist/niche-finder-extension-v<version>.zip (committed files only)
	sh scripts/package_extension.sh

# The dashboard smoke test in headless Chromium (frontend/tests/test_smoke.py): its own
# uvicorn on a free port + its own schema with demo data; it does not touch the working database.
# Once: ./backend/.venv/bin/pip install -r frontend/tests/requirements.txt
#           ./backend/.venv/bin/python -m playwright install chromium
frontend-test:  ## browser smoke test of every dashboard screen (needs: make up-db)
	@cd backend && export NICHE_DATABASE_URL="$${NICHE_DATABASE_URL:-$$(grep -E '^NICHE_DATABASE_URL=' ../.env 2>/dev/null | sed -E 's/^[^=]+=//; s/^"//; s/"$$//' | tr -d '\r')}"; \
	  ./.venv/bin/python -m pytest -q -p no:cacheprovider ../frontend/tests

local-run:      ## run the MCP server on the host
	cd backend && ./.venv/bin/python server.py

# Requires the line NICHE_DATABASE_URL=postgresql://niches:niches@localhost:5433/niches in .env
# (the compose database is published on 5433, while the default in code is 5432) and a free
# :8080 -- with the web container up, first `docker compose stop web`,
# otherwise the host uvicorn will grab the port and the container's port forward will silently break.
dev:    ## run the HTTP dashboard on the host, no Docker (needs: make local-install + NICHE_DATABASE_URL in .env)
	cd backend && ./.venv/bin/python -m uvicorn api:app --reload --host 127.0.0.1 --port 8080
