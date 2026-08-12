# Carga XRPL_PAT desde backend/.env y lo persiste como variable de entorno de usuario,
# para que el MCP "hackathon" (.mcp.json -> ${XRPL_PAT}) arranque en nuevas sesiones de Claude Code.
# Uso: powershell -File scripts/set-xrpl-pat.ps1
$envFile = Join-Path $PSScriptRoot "..\backend\.env"
$line = Select-String -Path $envFile -Pattern '^XRPL_PAT=(.+)$' | Select-Object -First 1
if (-not $line) {
    Write-Error "XRPL_PAT vacio en backend/.env - pega el token despues de 'XRPL_PAT=' y reejecuta."
    exit 1
}
$token = $line.Matches[0].Groups[1].Value.Trim()
if ($token -notlike 'xrpl_pat_*') {
    Write-Warning "El valor no empieza por 'xrpl_pat_' - comprueba que pegaste el token correcto."
}
[Environment]::SetEnvironmentVariable('XRPL_PAT', $token, 'User')
Write-Host "XRPL_PAT guardado como variable de entorno de usuario (longitud $($token.Length))."
Write-Host "Reinicia VS Code / la sesion de Claude Code para que el MCP 'hackathon' cargue."
