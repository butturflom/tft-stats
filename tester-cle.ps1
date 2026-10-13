# Test de la clé Riot API : n'affiche jamais la clé.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cfg = @{}
Get-Content (Join-Path $dir '.env') -Encoding UTF8 | ForEach-Object {
  $l = $_.Trim()
  if ($l -and -not $l.StartsWith('#') -and $l.Contains('=')) {
    $k, $v = $l.Split('=', 2); $cfg[$k.Trim()] = $v.Trim()
  }
}
$key = $cfg['RIOT_API_KEY']
$plat = if ($cfg['RIOT_PLATFORM']) { $cfg['RIOT_PLATFORM'] } else { 'euw1' }
if (-not $key) { Write-Host 'Aucune clé trouvée dans le fichier .env' -ForegroundColor Red; exit 1 }
$h = @{ 'X-Riot-Token' = $key }

function Test-Url($label, $url) {
  try {
    $r = Invoke-RestMethod -Uri $url -Headers $h -TimeoutSec 20
    Write-Host "OK     $label" -ForegroundColor Green
    return $r
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    $msg = switch ($code) {
      401 { 'clé absente ou mal collée' }
      403 { 'clé refusée : expirée ou invalide, régénère-la sur developer.riotgames.com' }
      429 { 'trop de requêtes, attends 2 minutes et relance' }
      $null { 'pas de connexion : ' + $_.Exception.Message }
      default { "erreur $code" }
    }
    Write-Host "ÉCHEC  $label : $msg" -ForegroundColor Red
    return $null
  }
}

Write-Host ''
Write-Host 'Test de ta clé Riot API (serveur EUW)' -ForegroundColor Cyan
Write-Host ''
Test-Url 'Statut des serveurs TFT' "https://$plat.api.riotgames.com/tft/status/v1/platform-data" | Out-Null
$c = Test-Url 'Classement Challenger' "https://$plat.api.riotgames.com/tft/league/v1/challenger?queue=RANKED_TFT"
if ($c) { Write-Host ('       {0} joueurs Challenger' -f @($c.entries).Count) }
$s = Test-Url 'Joueurs Argent II' "https://$plat.api.riotgames.com/tft/league/v1/entries/SILVER/II?queue=RANKED_TFT&page=1"
if ($s) { Write-Host ('       {0} joueurs Argent II sur la première page' -f @($s).Count) }
Write-Host ''
Write-Host 'Outils installés sur ce PC :' -ForegroundColor Cyan
foreach ($t in @(@('Node.js','node','-v'), @('Python','python','--version'), @('Python (py)','py','--version'))) {
  $cmd = Get-Command $t[1] -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { try { $v = & $t[1] $t[2] 2>&1 | Select-Object -First 1; Write-Host ("       {0} : {1}" -f $t[0], $v) } catch { Write-Host ("       {0} : non trouvé" -f $t[0]) } }
  else { Write-Host ("       {0} : non trouvé" -f $t[0]) }
}
Write-Host ''
