@echo off
cd /d "%~dp0"
echo Bali Pin Map is running at http://localhost:5500
echo Close this window to stop the app.
start "" cmd /c "timeout /t 1 >nul & start http://localhost:5500/"
python -m http.server 5500
