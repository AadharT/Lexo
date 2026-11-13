param([Parameter(Mandatory=$true)][string]$AppHome,[Parameter(Mandatory=$true)][string]$ReleaseFile,[Parameter(Mandatory=$true)][string]$Version,[Parameter(Mandatory=$true)][string]$ExpectedSha256)
$ErrorActionPreference='Stop'
$source=Join-Path (Split-Path $PSScriptRoot -Parent) 'distribution';$AppHome=[IO.Path]::GetFullPath($AppHome)
if(Test-Path -LiteralPath $AppHome){if(-not(Test-Path -LiteralPath (Join-Path $AppHome 'lexo-app-home.json')) -and @(Get-ChildItem -LiteralPath $AppHome -Force).Count){throw 'Choose an empty application folder. No existing files were changed.'}}
[IO.Directory]::CreateDirectory($AppHome)|Out-Null
foreach($name in @('Lexo.Update.psm1','update-lexo.ps1','update-lexo.cmd','release-config.json')){$target=Join-Path $AppHome $name;if(-not(Test-Path -LiteralPath $target)){Copy-Item -LiteralPath (Join-Path $source $name) -Destination $target}}
Import-Module (Join-Path $AppHome 'Lexo.Update.psm1') -Force
if(-not(Test-Path -LiteralPath (Join-Path $AppHome 'lexo-app-home.json'))){Write-LexoJson (Join-Path $AppHome 'lexo-app-home.json') @{format=1;appId='in.lexo.desktop'}}
Install-LexoRelease -AppHome $AppHome -ReleaseFile $ReleaseFile -Version $Version -ExpectedSha256 $ExpectedSha256|Out-Null
Write-Host "Ready: $AppHome\Lexo.exe"
