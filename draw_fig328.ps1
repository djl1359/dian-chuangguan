Add-Type -AssemblyName System.Drawing
$script:omega = [char]0x03A9
$script:tu = [char]0x56FE
$black = [System.Drawing.Brushes]::Black
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 2.5)

function New-Font([float]$sz,[int]$bold){
  if($bold -eq 1){ return New-Object System.Drawing.Font -ArgumentList @("Arial", $sz, [System.Drawing.FontStyle]::Bold) }
  return New-Object System.Drawing.Font -ArgumentList @("Arial", $sz, [System.Drawing.FontStyle]::Regular)
}
function Draw-Text($g,[string]$s,[float]$sz,[float]$x,[float]$y){
  if(-not $s -or $s.Length -eq 0){ return }
  $f = New-Font $sz 0
  $g.DrawString($s,$f,$black,$x,$y)
  $f.Dispose()
}
function New-Canvas([int]$w,[int]$h){
  $bmp = New-Object System.Drawing.Bitmap($w,$h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::White)
  return @($bmp,$g)
}
function Draw-Line($g,[float]$x1,[float]$y1,[float]$x2,[float]$y2){
  $g.DrawLine($pen,$x1,$y1,$x2,$y2)
}
function Draw-Resistor($g,[float]$cx,[float]$cy,[float]$w,[float]$h,[string]$label,[float]$lx,[float]$ly){
  $r = New-Object System.Drawing.Rectangle([int]($cx-$w/2),[int]($cy-$h/2),[int]$w,[int]$h)
  $g.DrawRectangle($pen,$r)
  Draw-Text $g $label 13 $lx $ly
}
function Draw-Source($g,[float]$cx,[float]$cy,[float]$r,[int]$plusTop,[string]$label,[float]$lx,[float]$ly){
  $g.DrawEllipse($pen,$cx-$r,$cy-$r,2*$r,2*$r)
  if($plusTop -eq 1){
    Draw-Text $g "+" 15 ($cx-9) ($cy-$r-2)
    Draw-Text $g "-" 15 ($cx-6) ($cy+$r-14)
  } else {
    Draw-Text $g "-" 15 ($cx-6) ($cy-$r-14)
    Draw-Text $g "+" 15 ($cx-9) ($cy+$r-8)
  }
  Draw-Text $g $label 13 $lx $ly
}
function Draw-Arrow($g,[float]$x,[float]$y,[int]$up,[string]$label,[float]$lx,[float]$ly){
  $brush = [System.Drawing.Brushes]::Black
  if($up -eq 1){
    $pts = @(
      (New-Object System.Drawing.Point([int]$x,[int]($y-10))),
      (New-Object System.Drawing.Point([int]($x-6),[int]($y+4))),
      (New-Object System.Drawing.Point([int]($x+6),[int]($y+4)))
    )
    $g.FillPolygon($brush,$pts)
    $g.DrawLine($pen,$x,$y+4,$x,$y+26)
  } else {
    $pts = @(
      (New-Object System.Drawing.Point([int]$x,[int]($y+10))),
      (New-Object System.Drawing.Point([int]($x-6),[int]($y-4))),
      (New-Object System.Drawing.Point([int]($x+6),[int]($y-4)))
    )
    $g.FillPolygon($brush,$pts)
    $g.DrawLine($pen,$x,$y-4,$x,$y-26)
  }
  Draw-Text $g $label 14 $lx $ly
}
function Draw-NodeDot($g,[float]$x,[float]$y,[string]$label,[float]$lx,[float]$ly){
  $g.FillEllipse([System.Drawing.Brushes]::Black,$x-3.5,$y-3.5,7,7)
  Draw-Text $g $label 14 $lx $ly
}
function Save-Png($bmp,$g,[string]$path){
  $g.Dispose()
  $tmp = Join-Path $env:TEMP ("dc_" + [System.Guid]::NewGuid().ToString("N") + ".png")
  $bmp.Save($tmp,[System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Copy-Item -LiteralPath $tmp -Destination $path -Force
  Remove-Item -LiteralPath $tmp -Force
}

# ===== 图3-28：三支路并联 E1=40V(正极上) E2=5V(正极上) E3=25V(正极下) R1=5 R2=R3=10 =====
$c = New-Canvas 820 520
$g = $c[1]
Draw-Line $g 130 110 690 110
Draw-Line $g 130 410 690 410
Draw-Line $g 170 110 170 143
Draw-Source $g 170 160 17 1 "40V" 192 152
Draw-Line $g 170 177 170 245
Draw-Line $g 170 295 170 410
Draw-Resistor $g 170 270 30 14 "5$script:omega" 188 260
Draw-Arrow $g 196 228 1 "I1" 206 212
Draw-Line $g 400 110 400 143
Draw-Source $g 400 160 17 1 "5V" 422 152
Draw-Line $g 400 177 400 245
Draw-Line $g 400 295 400 410
Draw-Resistor $g 400 270 30 14 "10$script:omega" 418 260
Draw-Arrow $g 426 228 0 "I2" 436 234
Draw-Line $g 630 110 630 175
Draw-Line $g 630 225 630 283
Draw-Line $g 630 317 630 410
Draw-Resistor $g 630 200 30 14 "10$script:omega" 648 190
Draw-Source $g 630 300 17 0 "25V" 652 292
Draw-Arrow $g 656 188 0 "I3" 666 194
Draw-NodeDot $g 400 110 "A" 412 92
Draw-NodeDot $g 400 410 "B" 412 420
Draw-Text $g ($script:tu + "3-28") 17 370 466
Save-Png $c[0] $g "E:\测试项目\GitHub-1.3.0.0\电闯关·电工大作战\public\qimg\fig3-28.png"
Write-Output "fig3-28 saved"

# ===== 图3-30：三支路并联 E1=8V(正极上) E2=6V(正极上) R1=R2=R3=2 =====
$c = New-Canvas 820 520
$g = $c[1]
Draw-Line $g 130 110 690 110
Draw-Line $g 130 410 690 410
Draw-Line $g 170 110 170 143
Draw-Source $g 170 160 17 1 "8V" 192 152
Draw-Line $g 170 177 170 245
Draw-Line $g 170 295 170 410
Draw-Resistor $g 170 270 30 14 "2$script:omega" 188 260
Draw-Line $g 400 110 400 143
Draw-Source $g 400 160 17 1 "6V" 422 152
Draw-Line $g 400 177 400 245
Draw-Line $g 400 295 400 410
Draw-Resistor $g 400 270 30 14 "2$script:omega" 418 260
Draw-Line $g 630 110 630 195
Draw-Line $g 630 245 630 410
Draw-Resistor $g 630 220 30 14 "2$script:omega" 648 210
Draw-Arrow $g 656 168 0 "I3" 666 174
Draw-NodeDot $g 400 110 "A" 412 92
Draw-NodeDot $g 400 410 "B" 412 420
Draw-Text $g ($script:tu + "3-30") 17 370 466
Save-Png $c[0] $g "E:\测试项目\GitHub-1.3.0.0\电闯关·电工大作战\public\qimg\fig3-30.png"
Write-Output "fig3-30 saved"
