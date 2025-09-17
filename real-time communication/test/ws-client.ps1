# ws-client.ps1
param(
  [string]$uri = "ws://localhost:8080",
  [string]$name = "psClient"
)

Add-Type -AssemblyName System.Net.WebSockets.Client

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None

# Connect
[void]$ws.ConnectAsync([Uri]$uri, $ct).GetAwaiter().GetResult()
Write-Host "Connected to $uri"

# send helper
function Send-Json($obj) {
  $json = (ConvertTo-Json $obj -Compress)
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object System.ArraySegment[Byte] (,$bytes)
  [void]$ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).GetAwaiter().GetResult()
}

# receive loop in background job
$job = Start-Job -ScriptBlock {
  param($ws)
  while ($ws.State -eq 'Open') {
    $buffer = New-Object byte[] 4096
    $segment = New-Object System.ArraySegment[byte] (,$buffer)
    $result = $ws.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    if ($result.Count -gt 0) {
      $msg = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
      Write-Host "[recv] $msg"
    }
    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      Write-Host "Server closed"
      break
    }
  }
} -ArgumentList ($ws)

# Join a room
Send-Json @{ type='join'; room='room1'; name=$name }

# Simple REPL for sending
Write-Host "Type messages; /list to list, /quit to exit."
while ($true) {
  $line = Read-Host -Prompt ">"
  if ($line -eq '/quit') { break }
  if ($line -eq '/list') {
    Send-Json @{ type='list'; room='room1' }
  } else {
    Send-Json @{ type='msg'; room='room1'; text=$line }
  }
}

# Close safely
[void]$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "bye", $ct).GetAwaiter().GetResult()
Stop-Job $job | Out-Null
Write-Host "Disconnected"
