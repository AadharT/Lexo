$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'Lexo.Update.psm1') -Force
try{
 $active=Get-LexoActive $PSScriptRoot;if(-not $active){throw 'No Lexo release is selected. Run update-lexo or ask the developer to prepare this folder.'}
 $executable=Resolve-LexoExecutable $PSScriptRoot $active.current
 $previousReceipt=$env:LEXO_STARTUP_RECEIPT;$env:LEXO_STARTUP_RECEIPT=Join-Path $PSScriptRoot "logs/startup-$([Guid]::NewGuid()).json"
 try{Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable)|Out-Null}finally{if($previousReceipt){$env:LEXO_STARTUP_RECEIPT=$previousReceipt}else{Remove-Item Env:LEXO_STARTUP_RECEIPT -ErrorAction SilentlyContinue}}
}catch{Write-Host $_.Exception.Message -ForegroundColor Red;exit 1}
