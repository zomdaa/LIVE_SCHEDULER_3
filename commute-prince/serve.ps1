param([string]$Root = "D:\LIVE_SCHEDULER_3\commute-prince", [int]$Port = 8123)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $Root on http://localhost:$Port/"
$mime = @{ ".html"="text/html; charset=utf-8"; ".js"="text/javascript; charset=utf-8"; ".css"="text/css; charset=utf-8"; ".png"="image/png"; ".json"="application/json" }
while ($listener.IsListening) {
  try {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath
    if ($ctx.Request.HttpMethod -eq "POST" -and $path -eq "/shot") {
      $name = $ctx.Request.QueryString["name"]
      if (-not $name -or $name -notmatch '^[a-zA-Z0-9_-]+$') { $name = "shot" }
      $reader = New-Object System.IO.StreamReader($ctx.Request.InputStream)
      $b64 = $reader.ReadToEnd()
      $b64 = $b64 -replace '^data:image/png;base64,', ''
      $out = Join-Path $PSScriptRoot "$name.png"
      [System.IO.File]::WriteAllBytes($out, [Convert]::FromBase64String($b64))
      $buf = [System.Text.Encoding]::UTF8.GetBytes("saved $out")
      $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
      $ctx.Response.Close()
      continue
    }
    if ($path -eq "/") { $path = "/index.html" }
    $file = Join-Path $Root ($path -replace "/", "\")
    if ((Test-Path $file) -and (Resolve-Path $file).Path.StartsWith((Resolve-Path $Root).Path)) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      if ($mime.ContainsKey($ext)) { $ctx.Response.ContentType = $mime[$ext] }
      $ctx.Response.Headers.Add("Cache-Control", "no-store")
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
  } catch { }
}
