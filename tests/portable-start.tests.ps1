param([Parameter(Mandatory=$true)][string]$ReleaseFile)
$ErrorActionPreference='Stop'
$exe=(Resolve-Path -LiteralPath $ReleaseFile).Path
$testRoot=Join-Path ([IO.Path]::GetTempPath()) "lexo-start-test-$([Guid]::NewGuid())"
New-Item -ItemType Directory -Path $testRoot|Out-Null
$receipt=Join-Path $testRoot 'startup.json'
$savedProfile=$env:LEXO_DATA_DIR;$savedReceipt=$env:LEXO_STARTUP_RECEIPT;$savedDirectory=$env:LEXO_SKIP_DIRECTORY_DOWNLOAD
$env:LEXO_DATA_DIR=Join-Path $testRoot 'profile';$env:LEXO_STARTUP_RECEIPT=$receipt;$env:LEXO_SKIP_DIRECTORY_DOWNLOAD='1'
$fixtureScript=Join-Path $PSScriptRoot 'helpers/portable-workspace.cjs'
$nodeExecutable=(Get-Command node -ErrorAction Stop).Source
& $nodeExecutable $fixtureScript seed $testRoot | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not create the isolated release-test workspace.'}
$started=Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Hidden -PassThru
$startedAt=$started.StartTime
try{
 $deadline=[DateTime]::UtcNow.AddSeconds(60)
 while(-not(Test-Path -LiteralPath $receipt) -and [DateTime]::UtcNow -lt $deadline){
  $started.Refresh()
  if($started.HasExited){throw "Portable executable exited before startup (exit code $($started.ExitCode))."}
  if($started.MainWindowTitle -match 'NSIS Error'){throw 'Published portable executable failed its NSIS integrity check.'}
  Start-Sleep -Milliseconds 250
 }
 if(-not(Test-Path -LiteralPath $receipt)){throw 'Portable executable did not reach the application within 60 seconds.'}
 $status=Get-Content -LiteralPath $receipt -Raw|ConvertFrom-Json
 if($status.status -ne 'ready'){throw "Application startup failed: $($status.message)"}
 if(-not(Test-Path -LiteralPath (Join-Path $testRoot 'profile/library/lexo.sqlite'))){throw 'Isolated workspace was not created.'}
 $deadline=[DateTime]::UtcNow.AddSeconds(60)
 do{
  $indexState=& $nodeExecutable $fixtureScript check $testRoot | ConvertFrom-Json
  if($LASTEXITCODE -ne 0){throw 'Could not inspect the isolated text index.'}
  if($indexState.state -eq 'failed'){throw "Packaged text extraction failed: $($indexState|ConvertTo-Json -Depth 5 -Compress)"}
  if($indexState.state -eq 'ready'){break}
  Start-Sleep -Milliseconds 500
 }while([DateTime]::UtcNow -lt $deadline)
 if($indexState.state -ne 'ready'){throw "Packaged text extraction did not finish: $($indexState|ConvertTo-Json -Depth 5 -Compress)"}
 $packagedWorker=$null
 foreach($info in @(Get-CimInstance Win32_Process -Filter "Name = 'Lexo.exe'")){
  if($info.ExecutablePath){$candidate=Join-Path (Split-Path -Parent $info.ExecutablePath) 'resources/app.asar.unpacked/electron/document-search-worker.cjs';if(Test-Path -LiteralPath $candidate){$process=Get-Process -Id $info.ProcessId -ErrorAction SilentlyContinue;if($process -and $process.StartTime -ge $startedAt){$packagedWorker=$candidate;break}}}
 }
 if(-not $packagedWorker){throw 'Could not locate the released search worker in the test-created application.'}
 $searchState=& $nodeExecutable $fixtureScript search $testRoot $packagedWorker | ConvertFrom-Json
 if($LASTEXITCODE -ne 0 -or $searchState.state -ne 'ready'){throw 'The packaged read-only search worker failed its checks.'}
 Write-Host 'PASS: released executable indexes and searches PDF, DOCX and legacy files with the packaged read-only search worker.'
}finally{
 # Close only this test-created process and its descendants, never any existing Lexo instance.
 $all=@(Get-CimInstance Win32_Process);$known=[Collections.Generic.HashSet[int]]::new();$known.Add($started.Id)|Out-Null
 for($i=0;$i -lt 5;$i++){foreach($info in $all){if($known.Contains([int]$info.ParentProcessId)){$known.Add([int]$info.ProcessId)|Out-Null}}}
 foreach($testPid in $known){try{$p=Get-Process -Id $testPid -ErrorAction SilentlyContinue;if($p -and $p.StartTime -ge $startedAt){$p.CloseMainWindow()|Out-Null}}catch{}}
 Start-Sleep -Milliseconds 500
 foreach($testPid in $known){try{$p=Get-Process -Id $testPid -ErrorAction SilentlyContinue;if($p -and $p.StartTime -ge $startedAt){Stop-Process -Id $testPid -ErrorAction SilentlyContinue}}catch{}}
 $env:LEXO_DATA_DIR=$savedProfile;$env:LEXO_STARTUP_RECEIPT=$savedReceipt;$env:LEXO_SKIP_DIRECTORY_DOWNLOAD=$savedDirectory
 # Preserve test output for diagnosis on failure; contains fictional sample data only.
}
