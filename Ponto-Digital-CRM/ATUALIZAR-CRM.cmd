@echo off
title Atualizar Ponto Digital CRM
rem Atualiza o CRM com backup automatico, preservando .env.local e .data.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar-crm.ps1"
echo.
pause
