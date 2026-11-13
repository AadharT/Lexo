param([Parameter(Mandatory=$true)][string]$ReleaseFile)
$ErrorActionPreference='Stop'
$exe=(Resolve-Path -LiteralPath $ReleaseFile).Path
$testRoot=Join-Path ([IO.Path]::GetTempPath()) "lexo-start-test-$([Guid]::NewGuid())"
New-Item -ItemType Directory -Path $testRoot|Out-Null
$receipt=Join-Path $testRoot 'startup.json'
$savedProfile=$env:LEXO_DATA_DIR;$savedReceipt=$env:LEXO_STARTUP_RECEIPT;$savedDirectory=$env:LEXO_SKIP_DIRECTORY_DOWNLOAD
$env:LEXO_DATA_DIR=Join-Path $testRoot 'profile';$env:LEXO_STARTUP_RECEIPT=$receipt;$env:LEXO_SKIP_DIRECTORY_DOWNLOAD='1'
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
 Write-Host 'PASS: released portable executable reaches the application using an isolated workspace.'
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
