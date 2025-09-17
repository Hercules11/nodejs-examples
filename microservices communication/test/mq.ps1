# 启动一个 MQ 消费者
$client = New-Object System.Net.Sockets.TcpClient("localhost", 5000)
$stream = $client.GetStream()
$reader = New-Object System.IO.StreamReader($stream)
$writer = New-Object System.IO.StreamWriter($stream)

Write-Host "MQ Client connected. Listening messages..."

# 后台异步任务接收消息
Start-Job -ScriptBlock {
    param($reader)
    while ($true) {
        $msg = $reader.ReadLine()
        if ($msg) {
            Write-Host "Received:" $msg
        }
    }
} -ArgumentList $reader | Out-Null

# 模拟每隔 2s 发送消息
for ($i=0; $i -lt 5; $i++) {
    $msg = "Hello MQ $i at $(Get-Date)"
    $writer.WriteLine($msg)
    $writer.Flush()
    Start-Sleep -Seconds 2
}
