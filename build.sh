#!/usr/bin/env bash
# Render build: install deps, build React, collect static files, migrate the database.
set -o errexit

pip install -r backend/requirements.txt

cd frontend
npm ci
npm run build
cd ..

python backend/manage.py collectstatic --no-input
python backend/manage.py migrate --no-input
