@echo off
REM Flow Kit - Setup launcher for Windows (cmd.exe / double-click)
REM Runs setup.ps1 with ExecutionPolicy Bypass. Prefers PowerShell 7 (pwsh) if present.
where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
    pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
)
