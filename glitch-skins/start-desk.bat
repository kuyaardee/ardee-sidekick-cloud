@echo off
REM One-click launcher for the Desk skin (Windows).
REM Usage: start-desk.bat C:\path\to\your\project
REM Expects the Glitch Cat Club repo at %USERPROFILE%\ai-coding-skins with desk copied into its skins folder.
set SKINS=%USERPROFILE%\ai-coding-skins
if "%~1"=="" (
  echo Usage: start-desk.bat C:\path\to\your\project
  exit /b 1
)
start "Claude bridge - close this window to stop" /min cmd /k "cd /d %SKINS% && uv run python run.py --folder "%~1" --no-browser"
timeout /t 8 /nobreak >nul
start "" chrome --app=http://127.0.0.1:8770/skins/desk/
