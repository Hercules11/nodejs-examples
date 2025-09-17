$FILENAME = "bigfile.mp4"

curl.exe "http://localhost:3000/download?filename=$FILENAME" -o "./out_$FILENAME"


# Windows PowerShell 对比文件 hash
Get-FileHash bigfile.mp4
Get-FileHash out_bigfile.mp4
