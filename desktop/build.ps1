$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'
$cache = Join-Path $dist '.windows-build'
$null = New-Item -ItemType Directory -Path $cache -Force
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'

function Get-Sha256($file) {
    $stream = [IO.File]::OpenRead($file)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Get-BuildArchive($url, $name, $hash) {
    $file = Join-Path $cache $name
    if (!(Test-Path -LiteralPath $file) -or (Get-Sha256 $file) -ne $hash) {
        & curl.exe -fLsS --retry 4 --retry-all-errors --max-time 180 $url -o $file
        if ($LASTEXITCODE -ne 0 -or (Get-Sha256 $file) -ne $hash) {
            throw "Download or checksum failed for $name"
        }
    }
    return $file
}

$nodeVersion = '24.22.0'
$nodeFolder = "node-v$nodeVersion-win-x64"
$node = Get-BuildArchive "https://nodejs.org/dist/v$nodeVersion/$nodeFolder.zip" "$nodeFolder.zip" 'F9683A19877E12A9B167305C8DB71040D812876359DE21F0D2E97C3F321F80C3'
$webVersion = '1.0.4022.49'
$webView = Get-BuildArchive "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$webVersion/microsoft.web.webview2.$webVersion.nupkg" "webview2-$webVersion.nupkg" 'EE9DE67E5BB9EF3A96C5689B2EFC8188E2DF160A0E79234C0404243782FDE5FB'

$run = Join-Path $cache ('run-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $run 'payload'
$null = New-Item -ItemType Directory -Path $stage
try {
    & tar.exe -xf $node -C $run "$nodeFolder/node.exe" "$nodeFolder/LICENSE"
    if ($LASTEXITCODE -ne 0) { throw 'Node.js extraction failed' }
    & tar.exe -xf $webView -C $run 'lib/net462/Microsoft.Web.WebView2.Core.dll' 'lib/net462/Microsoft.Web.WebView2.WinForms.dll' 'runtimes/win-x64/native/WebView2Loader.dll' 'LICENSE.txt'
    if ($LASTEXITCODE -ne 0) { throw 'WebView2 SDK extraction failed' }

    Copy-Item -LiteralPath (Join-Path $run "$nodeFolder/node.exe") -Destination $stage
    Copy-Item -LiteralPath (Join-Path $run "$nodeFolder/LICENSE") -Destination (Join-Path $stage 'Node-LICENSE.txt')
    $dll = Join-Path $stage 'webview2'
    $null = New-Item -ItemType Directory -Path $dll
    $coreDll = 'Microsoft.Web.WebView2.Core.dll'
    $winFormsDll = 'Microsoft.Web.WebView2.WinForms.dll'
    Copy-Item -LiteralPath (Join-Path $run 'runtimes/win-x64/native/WebView2Loader.dll'),(Join-Path $run 'LICENSE.txt') -Destination $dll
    foreach ($dir in @('data', 'public', 'server')) {
        Copy-Item -LiteralPath (Join-Path $root $dir) -Destination $stage -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'server.cjs') -Destination (Join-Path $stage 'desktop-server.cjs')

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $payload = Join-Path $run 'payload.zip'
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $payload, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    $executable = Join-Path $run 'MHXXLibrary.exe'
    $sources = @('Launcher.cs', 'LibraryWindow.cs') | ForEach-Object { Join-Path $PSScriptRoot $_ }
    $references = @('System.Drawing.dll', 'System.Windows.Forms.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll', 'System.Net.Http.dll') |
        ForEach-Object { '/reference:' + (Join-Path $framework $_) }
    $managedDlls = @($coreDll, $winFormsDll)
    $references += $managedDlls | ForEach-Object { '/reference:' + (Join-Path $run "lib/net462/$_") }
    $resources = $managedDlls | ForEach-Object { '/resource:' + (Join-Path $run "lib/net462/$_") + ',' + $_ }
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 "/out:$executable" "/win32icon:$(Join-Path $PSScriptRoot 'icon.ico')" "/resource:$payload,mhxx-package.zip" @references @resources @sources
    if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed' }

    $product = (Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json).productName
    $output = Join-Path $dist "$product.exe"
    Copy-Item -LiteralPath $executable -Destination $output -Force
    Get-Item -LiteralPath $output | Select-Object FullName, Length
}
finally {
    $resolved = (Resolve-Path -LiteralPath $run).Path
    $cacheRoot = (Resolve-Path -LiteralPath $cache).Path + [IO.Path]::DirectorySeparatorChar
    if ($resolved.StartsWith($cacheRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
