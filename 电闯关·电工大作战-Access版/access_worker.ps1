# ============================================================
# access_worker.ps1 - Access(.accdb) database ADO executor
# Called by access.js via: powershell.exe -File access_worker.ps1
# Params:
#   -Db       database file path (.accdb / .mdb)
#   -Mode     init: create db + tables | exec: batch execute | query: single query
#   -Sql64    base64(UTF8) SQL. query: one SQL; exec/init: JSON array of SQL
#   -SqlFile  alternative: UTF8 text file containing the SQL (used when too long)
#   -Out      output file (UTF8 no-BOM JSON: {ok,rows|err})
# NOTE: keep this file pure ASCII to avoid PS 5.1 encoding issues.
# COM objects are explicitly released to avoid AV crash on process exit.
# ============================================================
param(
  [string]$Db,
  [string]$Mode = 'query',
  [string]$Sql64 = '',
  [string]$SqlFile = '',
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false)
$conn = $null
$rs = $null
$cat = $null
function Release([object]$o) {
  if ($null -ne $o) {
    try { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($o) } catch {}
  }
}
function Emit([object]$obj) {
  $json = $obj | ConvertTo-Json -Depth 8 -Compress
  [IO.File]::WriteAllText($Out, $json, $utf8)
}
try {
  if (-not $Out) { throw 'missing -Out param' }
  if ($SqlFile -and (Test-Path $SqlFile)) {
    $sqlText = [IO.File]::ReadAllText($SqlFile, [Text.Encoding]::UTF8)
  } else {
    $sqlText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Sql64))
  }
  $connStr = "Provider=Microsoft.ACE.OLEDB.16.0;Data Source=$Db;"

  if ($Mode -eq 'init') {
    $cat = New-Object -ComObject ADOX.Catalog
    [void]$cat.Create($connStr)
    Release $cat
    $cat = $null
    $conn = New-Object -ComObject ADODB.Connection
    $conn.Open($connStr)
    $sqls = $sqlText | ConvertFrom-Json
    foreach ($s in $sqls) { $conn.Execute($s) | Out-Null }
    try { $conn.Close() } catch {}
    Release $conn
    $conn = $null
    Emit @{ ok = $true }
    exit 0
  }

  $conn = New-Object -ComObject ADODB.Connection
  $conn.Open($connStr)

  if ($Mode -eq 'exec') {
    $sqls = $sqlText | ConvertFrom-Json
    foreach ($s in $sqls) { $conn.Execute($s) | Out-Null }
    try { $conn.Close() } catch {}
    Release $conn
    $conn = $null
    Emit @{ ok = $true }
    exit 0
  }

  $rs = $conn.Execute($sqlText)
  $rows = @()
  if ($rs) {
    $fields = @()
    for ($i = 0; $i -lt $rs.Fields.Count; $i++) { $fields += $rs.Fields.Item($i).Name }
    while (-not $rs.EOF) {
      $row = [ordered]@{}
      foreach ($f in $fields) {
        $v = $rs.Fields.Item($f).Value
        if ($null -eq $v) { $row[$f] = $null }
        elseif ($v -is [datetime]) { $row[$f] = $v.ToString('yyyy-MM-dd HH:mm:ss') }
        else { $row[$f] = $v }
      }
      $rows += ,$row
      $rs.MoveNext()
    }
    try { $rs.Close() } catch {}
    Release $rs
    $rs = $null
  }
  try { $conn.Close() } catch {}
  Release $conn
  $conn = $null
  Emit @{ ok = $true; rows = $rows }
  exit 0
} catch {
  if ($null -ne $rs) { try { Release $rs } catch {} }
  if ($null -ne $conn) { try { Release $conn } catch {} }
  if ($null -ne $cat) { try { Release $cat } catch {} }
  try { Emit @{ ok = $false; err = $_.Exception.Message } } catch {}
  exit 1
}
