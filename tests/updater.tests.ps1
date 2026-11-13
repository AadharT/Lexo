param([Parameter(Mandatory=$true)][string]$ReleaseFile,[Parameter(Mandatory=$true)][string]$Version,[string]$PreviousReleaseFile)
$ErrorActionPreference='Stop'
Import-Module (Join-Path (Split-Path $PSScriptRoot -Parent) 'distribution/Lexo.Update.psm1') -Force
$ReleaseFile=(Resolve-Path -LiteralPath $ReleaseFile).Path
$testRoot=Join-Path ([IO.Path]::GetTempPath()) "lexo-update-test-$([Guid]::NewGuid())"
$testAppHome=Join-Path $testRoot 'application';$workspace=Join-Path $testRoot 'firm';[IO.Directory]::CreateDirectory($workspace)|Out-Null
[IO.File]::WriteAllText((Join-Path $workspace 'lexo.sqlite'),'sample workspace bytes - never touched by updater')
$before=(Get-FileHash -LiteralPath (Join-Path $workspace 'lexo.sqlite')).Hash
Write-LexoJson (Join-Path $testAppHome 'lexo-app-home.json') @{format=1;appId='in.lexo.desktop'}
$sha=(Get-FileHash -LiteralPath $ReleaseFile -Algorithm SHA256).Hash.ToLowerInvariant()
function Reject([scriptblock]$Action,[string]$Expected){try{& $Action|Out-Null}catch{if($_.Exception.Message -notmatch $Expected){throw};return};throw "Expected rejection: $Expected"}
try{
 Reject {Install-LexoRelease $testAppHome $ReleaseFile $Version ('0'*64) $workspace} 'checksum'
 if(Test-Path -LiteralPath (Join-Path $testAppHome 'active.json')){throw 'Bad release changed the application pointer.'}
 if($PreviousReleaseFile){
  $previousFile=(Resolve-Path -LiteralPath $PreviousReleaseFile).Path
  $previousVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo($previousFile).ProductVersion
  $previousHash=(Get-FileHash -LiteralPath $previousFile).Hash.ToLowerInvariant()
  Install-LexoRelease $testAppHome $previousFile $previousVersion $previousHash $workspace|Out-Null
 }
 $active=Install-LexoRelease $testAppHome $ReleaseFile $Version $sha $workspace
 if(@(Get-ChildItem -LiteralPath $testAppHome -Filter '*.exe').Count -ne 1){throw 'Expected one installed executable.'}
 if(Test-Path -LiteralPath (Join-Path $testAppHome 'versions')){throw 'Version folders must not be retained.'}
 if($active.current.version -ne $Version){throw 'Incorrect active version.'}
 $exe=Resolve-LexoExecutable $testAppHome $active.current
 if((Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant() -ne $sha){throw 'Installed bytes differ.'}
 Install-LexoRelease $testAppHome $ReleaseFile $Version $sha $workspace|Out-Null
 Reject {Assert-LexoClosed @([pscustomobject]@{Name='WINWORD'})} 'close Lexo'
 Assert-LexoClosed @()
 Reject {Assert-LexoWorkspaceSeparate $testAppHome (Join-Path $testAppHome 'firm')} 'inside'
 Reject {Resolve-LexoExecutable $testAppHome ([pscustomobject]@{relativePath='../Lexo.exe';sha256=$sha})} 'Invalid release'
 # Simulate version metadata from an earlier/later installed binary while testing the real file swap.
 $module=Get-Module Lexo.Update
 & $module { $script:originalActive=${function:Get-LexoActive};$script:simulatedVersion='0.0.1';$script:reads=0;function script:Get-LexoActive {param($AppHome);$value=& $script:originalActive $AppHome;if($value -and $script:reads++ -eq 0){$value.current.version=$script:simulatedVersion};return $value} }
 try{
  Install-LexoRelease $testAppHome $ReleaseFile $Version $sha $workspace|Out-Null
  & $module {$script:simulatedVersion='0.0.1';$script:reads=0}
  $locked=[IO.File]::Open($exe,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try{Reject {Install-LexoRelease $testAppHome $ReleaseFile $Version $sha $workspace} 'used by another process|being used|access'}finally{$locked.Dispose()}
  if((Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant() -ne $sha){throw 'Failed replacement changed the installed executable.'}
  & $module {$script:simulatedVersion='99.0.0';$script:reads=0}
  Reject {Install-LexoRelease $testAppHome $ReleaseFile $Version $sha $workspace} 'Downgrades'
 }finally{& $module {Set-Item Function:script:Get-LexoActive $script:originalActive}}
 if((Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant() -ne $sha){throw 'Replacement changed expected executable bytes.'}
 if(@(Get-ChildItem -LiteralPath $testAppHome -Filter 'Lexo.partial-*').Count){throw 'Temporary application copy was retained.'}
 if((Get-FileHash -LiteralPath (Join-Path $workspace 'lexo.sqlite')).Hash -ne $before){throw 'Workspace changed.'}
 Write-Host 'PASS: checksum rejection, single executable, atomic replacement, idempotence, process guard, path guard, downgrade refusal, unchanged workspace.'
}finally{
 # Delete only this test-created directory within the system temporary folder.
 if(-not(Test-LexoInside ([IO.Path]::GetTempPath()) $testRoot) -or (Split-Path -Leaf $testRoot) -notlike 'lexo-update-test-*'){throw 'Unsafe test cleanup target.'}
 Remove-Item -LiteralPath $testRoot -Recurse -Force
}
