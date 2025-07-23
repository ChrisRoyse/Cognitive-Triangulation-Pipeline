@echo off
echo Starting Cognitive Triangulation Pipeline with FORCE_MAX_CONCURRENCY=1
echo.

REM Set environment variables
set FORCE_MAX_CONCURRENCY=1
set NODE_ENV=debug
set LOG_LEVEL=info

echo Configuration:
echo - FORCE_MAX_CONCURRENCY=%FORCE_MAX_CONCURRENCY%
echo - NODE_ENV=%NODE_ENV%
echo - Target Directory: polyglot-test
echo.

echo Running pipeline...
node src\main.js --target polyglot-test

echo.
echo Pipeline execution completed.
pause