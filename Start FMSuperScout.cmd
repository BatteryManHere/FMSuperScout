@echo off
title FMSuperScout
cd /d "%~dp0app"
set "PATH=%PATH%;C:\Program Files\nodejs;%LOCALAPPDATA%\Microsoft\dotnet"
start "" http://localhost:8765
if exist "C:\Program Files\nodejs\node.exe" (
    "C:\Program Files\nodejs\node.exe" server.js
) else (
    node server.js
)
pause
