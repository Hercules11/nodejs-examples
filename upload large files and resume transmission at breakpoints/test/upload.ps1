# 生成一个 fileId
$FILEID = [guid]::NewGuid().ToString("N")
$FILENAME = "bigfile.mp4"
$TOTAL = (Get-ChildItem "$FILENAME.*").Count

# 上传循环
$i = 0
Get-ChildItem "$FILENAME.*" | Sort-Object Name | ForEach-Object {
  Write-Host "Uploading chunk $i / $TOTAL ..."
  curl.exe -X POST "http://localhost:3000/upload?fileId=$FILEID&index=$i&total=$TOTAL&filename=$FILENAME" --data-binary "@$($_.FullName)"
  $i++
}

# 查看上传状态
curl.exe "http://localhost:3000/status?fileId=$FILEID"

#  Create a temporary JSON file with variables
$body = @{
  fileId = $FILEID
  filename = $FILENAME
  total = $TOTAL
}

$jsonBody = $body | ConvertTo-Json


# 请求合并
# 在 Windows 的现代 PowerShell 中，curl 实际上是 Invoke-WebRequest 的别名。如果你只输入 curl 而不指定 curl.exe，你运行的其实是 PowerShell 的内置 cmdlet，它支持 -Body 参数。但是，当你明确指定 curl.exe 时，你调用的是独立的外部程序，规则就完全不同了
# curl.exe 是一个独立的外部程序，它有自己的参数体系，它不认识 PowerShell cmdlet 的 -Body 参数。在 curl.exe 中，用于指定请求体数据的参数是 -d 或 --data
# curl.exe -X POST "http://localhost:3000/merge" -H "Content-Type: application/json"  -Body ($body | ConvertTo-Json) // error
Invoke-RestMethod -Uri "http://localhost:3000/merge" `
    -Method Post `
    -Headers @{ "Content-Type" = "application/json" } `
    -Body ($body | ConvertTo-Json)