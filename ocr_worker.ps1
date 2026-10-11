# ocr_worker.ps1 — Windows.Media.Ocr 中文识别（UTF-8 BOM 保存）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File ocr_worker.ps1 -Image <path> -Out <json>
param(
  [string]$Image = '',
  [string]$Out = ''
)
$ErrorActionPreference = 'Stop'
function Write-Out($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 6
  [System.IO.File]::WriteAllText($Out, $json, (New-Object System.Text.UTF8Encoding $false))
  exit 0
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
  }

  if (-not $Image -or -not (Test-Path $Image)) { Write-Out @{ ok = $false; err = '图片文件不存在' } }
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Image)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language('zh-Hans-CN')))
  if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if (-not $engine) { Write-Out @{ ok = $false; err = '无可用 OCR 引擎' } }

  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($ln in $result.Lines) {
    $words = @()
    foreach ($w in $ln.Words) {
      $words += @{ t = $w.Text; c = [Math]::Round($w.BoundingRect.Left); r = [Math]::Round($w.BoundingRect.Top) }
    }
    $lines += @{ text = $ln.Text; words = $words }
  }
  Write-Out @{ ok = $true; text = $result.Text; lines = $lines }
} catch {
  Write-Out @{ ok = $false; err = $_.Exception.Message }
}
