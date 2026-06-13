@echo off
title Agentic Starter App
REM Double-click to launch Agentic Starter as a native app (the top-center pill).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-coordinator-app.ps1"
if errorlevel 1 pause
