@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" abrir_app.py
) else (
    where py >nul 2>nul
    if errorlevel 1 (
        python abrir_app.py
    ) else (
        py -3 abrir_app.py
    )
)
pause
