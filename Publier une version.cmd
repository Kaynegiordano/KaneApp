@echo off
rem Construit l'installateur et publie la release GitHub correspondant a la version de package.json.
cd /d "%~dp0"
for /f %%v in ('node -p "require('./package.json').version"') do set VER=%%v
echo Version %VER%
call npm run dist || exit /b 1
set GH="C:\Program Files\GitHub CLI\gh.exe"
%GH% release create v%VER% "dist\Kanevas-Setup-%VER%.exe" "dist\Kanevas-Setup-%VER%.exe.blockmap" "dist\latest.yml" --repo Kaynegiordano/Kanevas --title "KaneApp %VER%" --notes-file RELEASE_NOTES.md