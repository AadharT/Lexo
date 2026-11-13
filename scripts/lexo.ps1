param([ValidateSet('dev','build','start','test','package','setup')][string]$Task='dev')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
$projectRuntime=Join-Path (Get-Location).Path '.runtime/node.exe'
if(Test-Path -LiteralPath $projectRuntime){$nodeExecutable=$projectRuntime}
else {
 $nodeCommand=Get-Command node -ErrorAction SilentlyContinue
 if (-not $nodeCommand) { throw 'Install Node.js 24 LTS or newer, then run this command again.' }
 $nodeExecutable=$nodeCommand.Source
}
$env:PATH="$(Split-Path $nodeExecutable -Parent);$((Get-Location).Path)\node_modules\.bin;$env:PATH"
switch ($Task) {
 'dev' { & $nodeExecutable scripts/dev.mjs }
 'build' { & $nodeExecutable node_modules/vite/bin/vite.js build }
 'start' { & $nodeExecutable node_modules/electron/cli.js . }
 'test' { & $nodeExecutable --test tests/*.test.cjs }
 'package' { & $nodeExecutable node_modules/vite/bin/vite.js build; if($LASTEXITCODE -eq 0){ & $nodeExecutable node_modules/electron-builder/cli.js --win portable } }
 'setup' {
   $pnpmCommand=Get-Command pnpm -ErrorAction SilentlyContinue
   $bundledPnpm=Join-Path (Split-Path $nodeExecutable -Parent) '../node_modules/pnpm/bin/pnpm.cjs'
   $env:ELECTRON_SKIP_BINARY_DOWNLOAD='1'
   if($pnpmCommand){ & $pnpmCommand.Source install --frozen-lockfile }
   elseif(Test-Path -LiteralPath $bundledPnpm){ & $nodeExecutable $bundledPnpm install --frozen-lockfile }
   else { throw 'Install pnpm 11.25.0 using npm install -g pnpm@11.25.0, then run setup again.' }
   if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
   Remove-Item Env:ELECTRON_SKIP_BINARY_DOWNLOAD
   & $nodeExecutable scripts/install-electron.mjs
 }
}
exit $LASTEXITCODE
