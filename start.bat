@echo off
rem Run Bali Pin Map locally: builds the React app, then serves everything from Django.
cd /d "%~dp0"
if not exist .venv (
  python -m venv .venv
  .venv\Scripts\pip install -r backend\requirements.txt
)
cd frontend
if not exist node_modules call npm install
call npm run build
cd ..
.venv\Scripts\python backend\manage.py migrate --no-input
echo.
echo Bali Pin Map is running at http://localhost:8000  (close this window to stop)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8000/"
.venv\Scripts\python backend\manage.py runserver 8000
