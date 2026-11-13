Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Write-LexoJson {
 param([string]$Path,[object]$Value)
 $folder=Split-Path -Parent $Path;[IO.Directory]::CreateDirectory($folder)|Out-Null
 $temporary="$Path.partial-$([Guid]::NewGuid())";$bytes=[Text.UTF8Encoding]::new($false).GetBytes(($Value|ConvertTo-Json -Depth 12))
 $stream=[IO.File]::Open($temporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}
 if(Test-Path -LiteralPath $Path){[IO.File]::Replace($temporary,$Path,"$Path.bak",$true)}else{[IO.File]::Move($temporary,$Path)}
}
function Test-LexoInside {
 param([string]$Root,[string]$Path)
 $base=[IO.Path]::GetFullPath($Root).TrimEnd('\')+'\';$candidate=[IO.Path]::GetFullPath($Path)
 return $candidate.Equals($base.TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase) -or $candidate.StartsWith($base,[StringComparison]::OrdinalIgnoreCase)
}
function Assert-LexoHome {
 param([string]$AppHome)
 $marker=Join-Path $AppHome 'lexo-app-home.json'
 if(-not(Test-Path -LiteralPath $marker)){throw 'This is not a prepared Lexo application folder. Run the supplied preparation command first.'}
 $value=Get-Content -LiteralPath $marker -Raw|ConvertFrom-Json
 if($value.appId -ne 'in.lexo.desktop' -or $value.format -ne 1){throw 'The application-folder marker is invalid.'}
 if((Get-Item -LiteralPath $AppHome).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Use a normal application folder, not a symbolic link.'}
 foreach($dataName in @('lexo.sqlite','cases','library')){if(Test-Path -LiteralPath (Join-Path $AppHome $dataName)){throw 'The application folder contains workspace data. Updates have been refused.'}}
}
function Get-LexoActive {
 param([string]$AppHome)
 Assert-LexoHome $AppHome;$file=Join-Path $AppHome 'active.json';if(-not(Test-Path -LiteralPath $file)){return $null}
 try{$value=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json;if($value.format -ne 1 -or -not $value.current){throw 'invalid pointer'};return $value}catch{throw 'The application pointer is unreadable. Previous releases and active.json.bak were preserved; contact support.'}
}
function Resolve-LexoExecutable {
 param([string]$AppHome,[object]$Release)
 if($Release.relativePath -notmatch '^versions/[0-9]+\.[0-9]+\.[0-9]+/Lexo\.exe$'){throw 'Invalid release path.'}
 $file=[IO.Path]::GetFullPath((Join-Path $AppHome $Release.relativePath))
 if(-not(Test-LexoInside (Join-Path $AppHome 'versions') $file)){throw 'The release path leaves the application folder.'}
 if(-not(Test-Path -LiteralPath $file)){throw 'The selected application release is missing. Your workspace was not changed.'}
 if((Get-Item -LiteralPath (Split-Path -Parent $file)).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'A release folder cannot be a symbolic link.'}
 if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Release.sha256){throw 'The application checksum does not match. Your workspace was not changed.'}
 return $file
}
function Assert-LexoClosed {
 param([object[]]$RunningProcesses=@(Get-Process -Name Lexo,WINWORD -ErrorAction SilentlyContinue))
 if($RunningProcesses.Count){throw 'Save your work and close Lexo and Microsoft Word, then run update-lexo again. No processes were stopped and no files were replaced.'}
}
function Assert-LexoWorkspaceSeparate {
 param([string]$AppHome,[string]$WorkspaceRoot)
 if($WorkspaceRoot -and (Test-LexoInside $AppHome $WorkspaceRoot)){throw 'The workspace is inside the application folder. Move it using Lexo Settings before updating.'}
}
function Install-LexoRelease {
 param([string]$AppHome,[string]$ReleaseFile,[string]$Version,[string]$ExpectedSha256,[string]$WorkspaceRoot)
 Assert-LexoHome $AppHome;Assert-LexoWorkspaceSeparate $AppHome $WorkspaceRoot
 if($Version -notmatch '^\d+\.\d+\.\d+$' -or $ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$'){throw 'A valid release version and SHA-256 checksum are required.'}
 $expected=$ExpectedSha256.ToLowerInvariant();if((Get-FileHash -LiteralPath $ReleaseFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Downloaded release failed checksum verification. The active version was not changed.'}
 $info=[Diagnostics.FileVersionInfo]::GetVersionInfo([IO.Path]::GetFullPath($ReleaseFile))
 if($info.ProductName -ne 'Lexo' -or $info.ProductVersion -ne $Version){throw 'Release identity/version does not match its metadata.'}
 $active=Get-LexoActive $AppHome
 if($active){if([Version]$Version -lt [Version]$active.current.version){throw 'Downgrades are refused to protect newer workspace data.'};if([Version]$Version -eq [Version]$active.current.version){if($active.current.sha256 -ne $expected){throw 'This version already exists with different bytes. Publish a new version number.'};Resolve-LexoExecutable $AppHome $active.current|Out-Null;return $active}}
 $versions=Join-Path $AppHome 'versions';[IO.Directory]::CreateDirectory($versions)|Out-Null
 if((Get-Item -LiteralPath $versions).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'The versions folder cannot be a symbolic link.'}
 $destination=Join-Path $versions $Version;$stage=Join-Path $versions ".staging-$([Guid]::NewGuid())"
 if(Test-Path -LiteralPath $destination){$existing=Join-Path $destination 'Lexo.exe';if(-not(Test-Path -LiteralPath $existing) -or (Get-FileHash -LiteralPath $existing -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'A conflicting release folder exists. It was preserved.'}}
 else{[IO.Directory]::CreateDirectory($stage)|Out-Null;$copied=Join-Path $stage 'Lexo.exe';[IO.File]::Copy([IO.Path]::GetFullPath($ReleaseFile),$copied,$false);$stream=[IO.File]::Open($copied,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read);try{$stream.Flush($true)}finally{$stream.Dispose()};if((Get-FileHash -LiteralPath $copied -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'The staged application failed verification. The active version was not changed.'};[IO.Directory]::Move($stage,$destination)}
 $previous=$null;if($active){$previous=$active.current};$value=[ordered]@{format=1;current=@{version=$Version;relativePath="versions/$Version/Lexo.exe";sha256=$expected};previous=$previous;updatedAt=[DateTime]::UtcNow.ToString('o')}
 Write-LexoJson (Join-Path $AppHome 'active.json') $value
 return ($value|ConvertTo-Json -Depth 12|ConvertFrom-Json)
}
Export-ModuleMember -Function Write-LexoJson,Test-LexoInside,Assert-LexoHome,Get-LexoActive,Resolve-LexoExecutable,Assert-LexoClosed,Assert-LexoWorkspaceSeparate,Install-LexoRelease
