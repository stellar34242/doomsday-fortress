param(
    [Parameter(Mandatory = $true)]
    [string]$SourceImage,
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,
    [string]$OutputBaseName = 'puddle_autotile_xp',
    [switch]$NoShore,
    [int]$SourceCropX = -1,
    [int]$SourceCropY = -1,
    [int]$SourceCropSize = 0
)

Add-Type -AssemblyName System.Drawing

$tileSize = 32
$sheetWidth = 96
$sheetHeight = 128

if (-not (Test-Path -LiteralPath $SourceImage)) {
    throw "Source image not found: $SourceImage"
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

function New-EmptyMask {
    return ,([bool[,]]::new($tileSize, $tileSize))
}

function Get-EdgeOffset([int]$index) {
    $pattern = @(0, 0, 1, 1, 0, -1, -1, 0, 1, 0, -1, -1, 0, 1, 1, 0,
                 0, -1, 0, 1, 1, 0, -1, 0, 1, 1, 0, -1, -1, 0, 0, 0)
    return $pattern[$index % 32]
}

function New-TileMask([string]$kind) {
    $mask = New-EmptyMask
    for ($y = 0; $y -lt $tileSize; $y++) {
        for ($x = 0; $x -lt $tileSize; $x++) {
            $edgeX = 6 + (Get-EdgeOffset $x)
            $edgeY = 6 + (Get-EdgeOffset $y)
            $inside = $false

            switch ($kind) {
                'A' {
                    $dx = ($x - 15.5) / 12.7
                    $dy = ($y - 15.5) / 9.8
                    $wobble = (((($x * 17) + ($y * 31)) % 7) - 3) * 0.008
                    $inside = (($dx * $dx) + ($dy * $dy)) -le (1.0 + $wobble)
                }
                'B' { $inside = $false }
                'C' {
                    $r2 = 92
                    $outsideCorner = (($x * $x + $y * $y) -lt $r2) -or
                                     (((31 - $x) * (31 - $x) + $y * $y) -lt $r2) -or
                                     (($x * $x + (31 - $y) * (31 - $y)) -lt $r2) -or
                                     (((31 - $x) * (31 - $x) + (31 - $y) * (31 - $y)) -lt $r2)
                    $inside = -not $outsideCorner
                }
                'TL' {
                    $e = 6
                    $d2 = (($x - $e) * ($x - $e)) + (($y - $e) * ($y - $e))
                    $inside = (($x -ge $e) -and ($y -ge $edgeX)) -or
                              (($y -ge $e) -and ($x -ge $edgeY)) -or
                              (($x -lt $e) -and ($y -lt $e) -and ($d2 -le 36))
                }
                'T'  { $inside = $y -ge $edgeX }
                'TR' {
                    $e = 6
                    $cx = 31 - $e
                    $d2 = (($x - $cx) * ($x - $cx)) + (($y - $e) * ($y - $e))
                    $inside = (($x -le $cx) -and ($y -ge $edgeX)) -or
                              (($y -ge $e) -and ($x -le (31 - $edgeY))) -or
                              (($x -gt $cx) -and ($y -lt $e) -and ($d2 -le 36))
                }
                'L'  { $inside = $x -ge $edgeY }
                'M'  { $inside = $true }
                'R'  { $inside = $x -le (31 - $edgeY) }
                'BL' {
                    $e = 6
                    $cy = 31 - $e
                    $d2 = (($x - $e) * ($x - $e)) + (($y - $cy) * ($y - $cy))
                    $inside = (($x -ge $e) -and ($y -le (31 - $edgeX))) -or
                              (($y -le $cy) -and ($x -ge $edgeY)) -or
                              (($x -lt $e) -and ($y -gt $cy) -and ($d2 -le 36))
                }
                'D'  { $inside = $y -le (31 - $edgeX) }
                'BR' {
                    $e = 6
                    $cx = 31 - $e
                    $cy = 31 - $e
                    $d2 = (($x - $cx) * ($x - $cx)) + (($y - $cy) * ($y - $cy))
                    $inside = (($x -le $cx) -and ($y -le (31 - $edgeX))) -or
                              (($y -le $cy) -and ($x -le (31 - $edgeY))) -or
                              (($x -gt $cx) -and ($y -gt $cy) -and ($d2 -le 36))
                }
                default { throw "Unknown mask kind: $kind" }
            }
            $mask[$x, $y] = $inside
        }
    }
    return ,$mask
}

function Find-OppositeDistance([bool[,]]$mask, [int]$x, [int]$y, [bool]$target, [int]$maxRadius) {
    for ($radius = 1; $radius -le $maxRadius; $radius++) {
        for ($oy = -$radius; $oy -le $radius; $oy++) {
            for ($ox = -$radius; $ox -le $radius; $ox++) {
                if ([Math]::Max([Math]::Abs($ox), [Math]::Abs($oy)) -ne $radius) { continue }
                $nx = $x + $ox
                $ny = $y + $oy
                if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge 32 -or $ny -ge 32) { continue }
                if ($mask[$nx, $ny] -eq $target) { return $radius }
            }
        }
    }
    return 99
}

function Scale-Color([System.Drawing.Color]$color, [double]$factor, [int]$alpha) {
    $r = [Math]::Min(255, [Math]::Max(0, [int]($color.R * $factor)))
    $g = [Math]::Min(255, [Math]::Max(0, [int]($color.G * $factor)))
    $b = [Math]::Min(255, [Math]::Max(0, [int]($color.B * $factor)))
    return [System.Drawing.Color]::FromArgb($alpha, $r, $g, $b)
}

function Render-Tile([bool[,]]$mask, [System.Drawing.Bitmap]$waterTexture) {
    $tile = [System.Drawing.Bitmap]::new(32, 32, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    for ($y = 0; $y -lt 32; $y++) {
        for ($x = 0; $x -lt 32; $x++) {
            if ($mask[$x, $y]) {
                $sourceColor = $waterTexture.GetPixel($x, $y)
                $edgeDistance = Find-OppositeDistance $mask $x $y $false 2
                if ($NoShore -and $edgeDistance -eq 1) {
                    $tile.SetPixel($x, $y, (Scale-Color $sourceColor 1.12 218))
                } elseif ($NoShore -and $edgeDistance -eq 2) {
                    $tile.SetPixel($x, $y, (Scale-Color $sourceColor 1.05 214))
                } elseif ($edgeDistance -eq 1) {
                    $tile.SetPixel($x, $y, (Scale-Color $sourceColor 0.62 232))
                } elseif ($edgeDistance -eq 2) {
                    $tile.SetPixel($x, $y, (Scale-Color $sourceColor 0.82 224))
                } else {
                    $tile.SetPixel($x, $y, ([System.Drawing.Color]::FromArgb(214, $sourceColor.R, $sourceColor.G, $sourceColor.B)))
                }
            } else {
                if ($NoShore) {
                    $tile.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
                    continue
                }
                $waterDistance = Find-OppositeDistance $mask $x $y $true 3
                $noiseX = if ($x -eq 31) { 0 } else { $x }
                $noiseY = if ($y -eq 31) { 0 } else { $y }
                if ($waterDistance -eq 1) {
                    $tile.SetPixel($x, $y, ([System.Drawing.Color]::FromArgb(242, 66, 55, 43)))
                } elseif ($waterDistance -eq 2) {
                    $tile.SetPixel($x, $y, ([System.Drawing.Color]::FromArgb(220, 93, 77, 57)))
                } elseif ($waterDistance -eq 3 -and ((($noiseX * 11 + $noiseY * 7) % 3) -ne 0)) {
                    $tile.SetPixel($x, $y, ([System.Drawing.Color]::FromArgb(145, 54, 48, 39)))
                } else {
                    $tile.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
                }
            }
        }
    }
    return $tile
}

$source = [System.Drawing.Bitmap]::new($SourceImage)
$water = [System.Drawing.Bitmap]::new(32, 32, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$cropSize = if ($SourceCropSize -gt 0) { $SourceCropSize } else { [Math]::Min($source.Width, $source.Height) }
$cropX = if ($SourceCropX -ge 0) { $SourceCropX } else { [int](($source.Width - $cropSize) / 2) }
$cropY = if ($SourceCropY -ge 0) { $SourceCropY } else { [int](($source.Height - $cropSize) / 2) }
if ($cropX -lt 0 -or $cropY -lt 0 -or ($cropX + $cropSize) -gt $source.Width -or ($cropY + $cropSize) -gt $source.Height) {
    throw "Source crop is outside the image: x=$cropX y=$cropY size=$cropSize image=$($source.Width)x$($source.Height)"
}

for ($y = 0; $y -lt 32; $y++) {
    for ($x = 0; $x -lt 32; $x++) {
        $sx = $cropX + [int](($x + 0.5) * $cropSize / 32)
        $sy = $cropY + [int](($y + 0.5) * $cropSize / 32)
        $sx = [Math]::Min($source.Width - 1, $sx)
        $sy = [Math]::Min($source.Height - 1, $sy)
        $water.SetPixel($x, $y, $source.GetPixel($sx, $sy))
    }
}

# Force opposite edges to share identical pixels so the center tile repeats seamlessly.
for ($i = 0; $i -lt 32; $i++) {
    $lr = $water.GetPixel(0, $i)
    $water.SetPixel(31, $i, $lr)
    $tb = $water.GetPixel($i, 0)
    $water.SetPixel($i, 31, $tb)
}

$sheet = [System.Drawing.Bitmap]::new($sheetWidth, $sheetHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($sheet)
$graphics.Clear([System.Drawing.Color]::Transparent)
$graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy

$layout = @(
    [pscustomobject]@{ Kind = 'A'; Column = 0; Row = 0 }
    [pscustomobject]@{ Kind = 'B'; Column = 1; Row = 0 }
    [pscustomobject]@{ Kind = 'C'; Column = 2; Row = 0 }
    [pscustomobject]@{ Kind = 'TL'; Column = 0; Row = 1 }
    [pscustomobject]@{ Kind = 'T'; Column = 1; Row = 1 }
    [pscustomobject]@{ Kind = 'TR'; Column = 2; Row = 1 }
    [pscustomobject]@{ Kind = 'L'; Column = 0; Row = 2 }
    [pscustomobject]@{ Kind = 'M'; Column = 1; Row = 2 }
    [pscustomobject]@{ Kind = 'R'; Column = 2; Row = 2 }
    [pscustomobject]@{ Kind = 'BL'; Column = 0; Row = 3 }
    [pscustomobject]@{ Kind = 'D'; Column = 1; Row = 3 }
    [pscustomobject]@{ Kind = 'BR'; Column = 2; Row = 3 }
)

$renderedTiles = @{}
foreach ($entry in $layout) {
    $kind = [string]$entry.Kind
    $column = [int]$entry.Column
    $row = [int]$entry.Row
    $mask = New-TileMask $kind
    $tile = Render-Tile $mask $water
    $renderedTiles[$kind] = $tile
    $graphics.DrawImageUnscaled($tile, $column * 32, $row * 32)
}

function Copy-VerticalEdge([System.Drawing.Bitmap]$sourceTile, [int]$sourceX, [System.Drawing.Bitmap]$targetTile, [int]$targetX) {
    for ($y = 0; $y -lt 32; $y++) {
        $targetTile.SetPixel($targetX, $y, $sourceTile.GetPixel($sourceX, $y))
    }
}

function Copy-HorizontalEdge([System.Drawing.Bitmap]$sourceTile, [int]$sourceY, [System.Drawing.Bitmap]$targetTile, [int]$targetY) {
    for ($x = 0; $x -lt 32; $x++) {
        $targetTile.SetPixel($x, $targetY, $sourceTile.GetPixel($x, $sourceY))
    }
}

# Normalize shared edge pixels. This makes every legal neighbor pair identical at the seam.
Copy-VerticalEdge $renderedTiles['T'] 0 $renderedTiles['T'] 31
Copy-VerticalEdge $renderedTiles['T'] 0 $renderedTiles['TL'] 31
Copy-VerticalEdge $renderedTiles['T'] 31 $renderedTiles['TR'] 0
Copy-VerticalEdge $renderedTiles['M'] 0 $renderedTiles['M'] 31
Copy-VerticalEdge $renderedTiles['M'] 0 $renderedTiles['L'] 31
Copy-VerticalEdge $renderedTiles['M'] 31 $renderedTiles['R'] 0
Copy-VerticalEdge $renderedTiles['D'] 0 $renderedTiles['D'] 31
Copy-VerticalEdge $renderedTiles['D'] 0 $renderedTiles['BL'] 31
Copy-VerticalEdge $renderedTiles['D'] 31 $renderedTiles['BR'] 0

Copy-HorizontalEdge $renderedTiles['L'] 0 $renderedTiles['L'] 31
Copy-HorizontalEdge $renderedTiles['L'] 0 $renderedTiles['TL'] 31
Copy-HorizontalEdge $renderedTiles['L'] 31 $renderedTiles['BL'] 0
Copy-HorizontalEdge $renderedTiles['M'] 0 $renderedTiles['M'] 31
Copy-HorizontalEdge $renderedTiles['M'] 0 $renderedTiles['T'] 31
Copy-HorizontalEdge $renderedTiles['M'] 31 $renderedTiles['D'] 0
Copy-HorizontalEdge $renderedTiles['R'] 0 $renderedTiles['R'] 31
Copy-HorizontalEdge $renderedTiles['R'] 0 $renderedTiles['TR'] 31
Copy-HorizontalEdge $renderedTiles['R'] 31 $renderedTiles['BR'] 0

# Redraw the normalized tiles into the sheet.
foreach ($entry in $layout) {
    $graphics.DrawImageUnscaled($renderedTiles[[string]$entry.Kind], [int]$entry.Column * 32, [int]$entry.Row * 32)
}

function Assert-VerticalSeam([System.Drawing.Bitmap]$leftTile, [System.Drawing.Bitmap]$rightTile, [string]$label) {
    for ($y = 0; $y -lt 32; $y++) {
        if ($leftTile.GetPixel(31, $y).ToArgb() -ne $rightTile.GetPixel(0, $y).ToArgb()) {
            $leftValue = $leftTile.GetPixel(31, $y).ToArgb()
            $rightValue = $rightTile.GetPixel(0, $y).ToArgb()
            throw "Vertical seam mismatch ($label) at y=$y left=$leftValue right=$rightValue"
        }
    }
}

function Assert-HorizontalSeam([System.Drawing.Bitmap]$topTile, [System.Drawing.Bitmap]$bottomTile, [string]$label) {
    for ($x = 0; $x -lt 32; $x++) {
        if ($topTile.GetPixel($x, 31).ToArgb() -ne $bottomTile.GetPixel($x, 0).ToArgb()) {
            throw "Horizontal seam mismatch ($label) at x=$x"
        }
    }
}

Assert-VerticalSeam $renderedTiles['TL'] $renderedTiles['T'] 'TL-T'
Assert-VerticalSeam $renderedTiles['T'] $renderedTiles['TR'] 'T-TR'
Assert-VerticalSeam $renderedTiles['L'] $renderedTiles['M'] 'L-M'
Assert-VerticalSeam $renderedTiles['M'] $renderedTiles['R'] 'M-R'
Assert-VerticalSeam $renderedTiles['BL'] $renderedTiles['D'] 'BL-D'
Assert-VerticalSeam $renderedTiles['D'] $renderedTiles['BR'] 'D-BR'
Assert-HorizontalSeam $renderedTiles['TL'] $renderedTiles['L'] 'TL-L'
Assert-HorizontalSeam $renderedTiles['T'] $renderedTiles['M'] 'T-M'
Assert-HorizontalSeam $renderedTiles['TR'] $renderedTiles['R'] 'TR-R'
Assert-HorizontalSeam $renderedTiles['L'] $renderedTiles['BL'] 'L-BL'
Assert-HorizontalSeam $renderedTiles['M'] $renderedTiles['D'] 'M-D'
Assert-HorizontalSeam $renderedTiles['R'] $renderedTiles['BR'] 'R-BR'
Assert-VerticalSeam $renderedTiles['M'] $renderedTiles['M'] 'M repeat X'
Assert-HorizontalSeam $renderedTiles['M'] $renderedTiles['M'] 'M repeat Y'

$sheetPath = Join-Path $OutputDirectory ($OutputBaseName + '.png')
$sheet.Save($sheetPath, [System.Drawing.Imaging.ImageFormat]::Png)

# Build an orthogonal connection test from the exact generated tiles.
$mapRows = @(
    '0001000',
    '0011100',
    '0111110',
    '1111111',
    '0111110',
    '0011100',
    '0001000'
)
$preview = [System.Drawing.Bitmap]::new(224, 224, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$previewGraphics = [System.Drawing.Graphics]::FromImage($preview)
$previewGraphics.Clear([System.Drawing.Color]::FromArgb(255, 62, 55, 46))
$previewGraphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver

for ($gy = 0; $gy -lt $mapRows.Count; $gy++) {
    for ($gx = 0; $gx -lt 7; $gx++) {
        if ($mapRows[$gy][$gx] -ne '1') { continue }
        $north = $gy -gt 0 -and $mapRows[$gy - 1][$gx] -eq '1'
        $south = $gy -lt ($mapRows.Count - 1) -and $mapRows[$gy + 1][$gx] -eq '1'
        $west = $gx -gt 0 -and $mapRows[$gy][$gx - 1] -eq '1'
        $east = $gx -lt 6 -and $mapRows[$gy][$gx + 1] -eq '1'

        $column = if (-not $west) { 0 } elseif (-not $east) { 2 } else { 1 }
        $row = if (-not $north) { 1 } elseif (-not $south) { 3 } else { 2 }
        $kindLookup = @('TL', 'T', 'TR', 'L', 'M', 'R', 'BL', 'D', 'BR')
        $kind = $kindLookup[(($row - 1) * 3) + $column]
        $previewGraphics.DrawImageUnscaled($renderedTiles[$kind], $gx * 32, $gy * 32)
    }
}

$previewPath = Join-Path $OutputDirectory ($OutputBaseName + '_preview.png')
$preview.Save($previewPath, [System.Drawing.Imaging.ImageFormat]::Png)

$sheetPreview = [System.Drawing.Bitmap]::new(384, 512, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$sheetPreviewGraphics = [System.Drawing.Graphics]::FromImage($sheetPreview)
$sheetPreviewGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$sheetPreviewGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$sheetPreviewGraphics.Clear([System.Drawing.Color]::FromArgb(255, 42, 38, 34))
$sheetPreviewGraphics.DrawImage($sheet, [System.Drawing.Rectangle]::new(0, 0, 384, 512), 0, 0, 96, 128, [System.Drawing.GraphicsUnit]::Pixel)
$sheetPreviewPath = Join-Path $OutputDirectory ($OutputBaseName + '_sheet_preview.png')
$sheetPreview.Save($sheetPreviewPath, [System.Drawing.Imaging.ImageFormat]::Png)

$waterPath = Join-Path $OutputDirectory ($OutputBaseName + '_source_32.png')
$water.Save($waterPath, [System.Drawing.Imaging.ImageFormat]::Png)

$previewGraphics.Dispose()
$preview.Dispose()
$sheetPreviewGraphics.Dispose()
$sheetPreview.Dispose()
$graphics.Dispose()
$sheet.Dispose()
foreach ($tile in $renderedTiles.Values) { $tile.Dispose() }
$water.Dispose()
$source.Dispose()

Write-Output $sheetPath
Write-Output $previewPath
Write-Output $sheetPreviewPath
Write-Output $waterPath
