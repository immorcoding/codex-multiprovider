@echo off
rem Windows 0.159.2 four-patch debug installer; an existing frozen checkout is required.
rem Example: install-engine.cmd -EnginePath E:\Projects\codex -VerifyOnly
rem Historical 0.154 is explicit: -LegacyPatch. Extra arguments are passed through.
setlocal
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-engine.ps1" %*
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo Installer failed with exit code %EXITCODE%. Read the message above for the reason.
) else (
  echo Installer finished successfully.
)
pause
exit /b %EXITCODE%
