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
 if($PreviousReleaseFile){if($active.previous.version -ne $previousVersion){throw 'Previous release pointer not retained.'};Resolve-LexoExecutable $testAppHome $active.previous|Out-Null}
 if($active.current.version -ne $Version){throw 'Incorrect active version.'}
 $exe=Resolve-LexoExecutable $testAppHome $active.current
 if((Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant() -ne $sha){throw 'Installed bytes differ.'}
 Install-LexoRelease $testAppHome $ReleaseFile $Version $sha $workspace|Out-Null
 Reject {Assert-LexoClosed @([pscustomobject]@{Name='WINWORD'})} 'close Lexo'
 Assert-LexoClosed @()
 Reject {Assert-LexoWorkspaceSeparate $testAppHome (Join-Path $testAppHome 'firm')} 'inside'
 Reject {Resolve-LexoExecutable $testAppHome ([pscustomobject]@{relativePath='../Lexo.exe';sha256=$sha})} 'Invalid release'
 # Simulate a later active release: the earlier artifact must never replace it.
 $newer=[ordered]@{format=1;current=@{version='99.0.0';relativePath="versions/$Version/Lexo.exe";sha256=$sha};previous=$active.current}
 Write-LexoJson (Join-Path $testAppHome 'active.json') $newer
 Reject {Install-LexoRelease $testAppHome $ReleaseFile $Version $sha $workspace} 'Downgrades'
 if((Get-LexoActive $testAppHome).current.version -ne '99.0.0'){throw 'Downgrade mutated pointer.'}
 if(-not(Test-Path -LiteralPath (Join-Path $testAppHome 'active.json.bak'))){throw 'Previous pointer not retained.'}
 if((Get-FileHash -LiteralPath (Join-Path $workspace 'lexo.sqlite')).Hash -ne $before){throw 'Workspace changed.'}
 Write-Host 'PASS: checksum rejection, staged install, idempotence, process guard, path guard, downgrade refusal, retained pointer, unchanged workspace.'
}finally{
 # Delete only this test-created directory within the system temporary folder.
 if(-not(Test-LexoInside ([IO.Path]::GetTempPath()) $testRoot) -or (Split-Path -Leaf $testRoot) -notlike 'lexo-update-test-*'){throw 'Unsafe test cleanup target.'}
 Remove-Item -LiteralPath $testRoot -Recurse -Force
}
