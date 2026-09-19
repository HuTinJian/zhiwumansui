@echo off
chcp 65001 >nul
title 织雾满穗 - 版本回退小工具
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0rollback.ps1"
