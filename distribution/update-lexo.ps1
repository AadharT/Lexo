param([string]$ReleaseFile,[string]$Version,[string]$ExpectedSha256,[switch]$NoLaunch)
$ErrorActionPreference='Stop';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$downloadedFile=$null
Import-Module (Join-Path $PSScriptRoot 'Lexo.Update.psm1') -Force
try{
 Assert-LexoHome $PSScriptRoot;Assert-LexoClosed
 $configuration=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'release-config.json') -Raw|ConvertFrom-Json
 $profile=if($env:LEXO_DATA_DIR){$env:LEXO_DATA_DIR}else{Join-Path $env:APPDATA 'lexo'};$pointer=Join-Path $profile 'workspace.json';$workspace=Join-Path $profile 'library'
 if(Test-Path -LiteralPath $pointer){$workspace=(Get-Content -LiteralPath $pointer -Raw|ConvertFrom-Json).root}
 Assert-LexoWorkspaceSeparate $PSScriptRoot $workspace
 if(-not $ReleaseFile){
  $repository=$configuration.repository;if($repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'){throw 'Invalid release repository in release-config.json.'}
  Write-Host "Checking $repository for a release..."
  try{$release=Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases/latest" -Headers @{Accept='application/vnd.github+json';'User-Agent'='Lexo-Updater'} -TimeoutSec 30}catch{throw 'The release feed is unavailable. It may be private or have no published release. Your current app and workspace were not changed. Ask the developer for a release file or a public release feed.'}
  if($release.draft -or $release.prerelease -or $release.tag_name -notmatch '^v?\d+\.\d+\.\d+$'){throw 'The feed did not return a supported stable release.'}
  $Version=$release.tag_name -replace '^v','';$asset=@($release.assets|Where-Object name -EQ "Lexo-$Version-win-x64.exe")
  if($asset.Count -ne 1 -or $asset[0].digest -notmatch '^sha256:[a-f0-9]{64}$'){throw 'The release is missing its Windows executable or verified checksum.'}
  $ExpectedSha256=$asset[0].digest.Substring(7);$url=[Uri]$asset[0].browser_download_url
  if($url.Scheme -ne 'https' -or $url.Host -ne 'github.com' -or -not $url.AbsolutePath.StartsWith("/$repository/releases/download/",[StringComparison]::OrdinalIgnoreCase)){throw 'The release download URL is invalid.'}
  $current=Get-LexoActive $PSScriptRoot;if($current -and [Version]$Version -le [Version]$current.current.version){Write-Host 'Lexo is already on this release or a newer one.';exit 0}
  $ReleaseFile=Join-Path $PSScriptRoot "Lexo.download-$([Guid]::NewGuid())";$downloadedFile=$ReleaseFile;Write-Host 'Downloading Lexo...';Invoke-WebRequest -Uri $url.AbsoluteUri -OutFile $ReleaseFile -UseBasicParsing -TimeoutSec 300
 }
 if([Version]$Version -lt [Version]$configuration.minimumSafeVersion){throw 'This release predates the data-safety safeguards and cannot be installed by this updater.'}
 Assert-LexoClosed
 $result=Install-LexoRelease -AppHome $PSScriptRoot -ReleaseFile $ReleaseFile -Version $Version -ExpectedSha256 $ExpectedSha256 -WorkspaceRoot $workspace
 Write-Host "Lexo $($result.current.version) is ready at $PSScriptRoot\Lexo.exe. Your workspace was not replaced."
 if(-not $NoLaunch){Start-Process -FilePath (Join-Path $PSScriptRoot 'Lexo.exe') -WorkingDirectory $PSScriptRoot}
}catch{Write-Host $_.Exception.Message -ForegroundColor Red;exit 1}
finally{if($downloadedFile -and (Test-Path -LiteralPath $downloadedFile)){Remove-Item -LiteralPath $downloadedFile}}
