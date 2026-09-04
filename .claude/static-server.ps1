# Minimal static file server for this project (plain HTML/CSS/JS, no
# build step). Runs in the foreground so whatever launches this script
# can track/stop it as a normal child process. Serves files from the
# parent of this script's own directory (the project root), so it works
# regardless of where the repo is checked out. Adapted from
# tuckermills-portfolio's own .claude/static-server.ps1 -- a different
# port (5600) so both projects' local servers can run side by side, and
# no SPA fallback (this site has no client-side router).
$root = Split-Path -Parent $PSScriptRoot
$port = 5600

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
try {
    $listener.Start()
} catch {
    Write-Error "Could not bind to port $port -- it's likely already in use. $($_.Exception.Message)"
    exit 1
}
Write-Output "Serving '$root' at http://127.0.0.1:$port/"

$mimeMap = @{
    ".html" = "text/html"; ".js" = "application/javascript"; ".css" = "text/css"
    ".json" = "application/json"; ".svg" = "image/svg+xml"; ".jpg" = "image/jpeg"
    ".jpeg" = "image/jpeg"; ".png" = "image/png"; ".ico" = "image/x-icon"
}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    $path = $req.Url.LocalPath
    if ($path -eq "/") { $path = "/index.html" }
    $rel = $path.TrimStart("/") -replace "/", "\"
    $filePath = Join-Path $root $rel

    try {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $ext = [System.IO.Path]::GetExtension($filePath)
        $res.ContentType = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { "application/octet-stream" }
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $res.StatusCode = 404
    }
    $res.OutputStream.Close()
}
