function Call-GrpcLike($method, $params) {
    $client = New-Object System.Net.Sockets.TcpClient("localhost", 4000)
    $stream = $client.GetStream()
    $writer = New-Object System.IO.StreamWriter($stream)
    $reader = New-Object System.IO.StreamReader($stream)

    $json = ConvertTo-Json @{ method=$method; params=$params } -Compress
    $writer.WriteLine($json)
    $writer.Flush()

    $response = $reader.ReadLine()
    # 我在 Node.js 端用 socket.write(JSON.stringify(res)) 写回数据，但没有在末尾加换行符。PowerShell 端的 $reader.ReadLine() 会一直等到换行符（\n）才返回，所以它就卡住了。
    $client.Close()
    return $response | ConvertFrom-Json
}

Write-Host "== sayHello =="
Call-GrpcLike "sayHello" @{ name="wxc" } | ConvertTo-Json

Write-Host "`n== add =="
Call-GrpcLike "add" @{ a=3; b=5 } | ConvertTo-Json
