
$TOKEN = "eyJ1c2VybmFtZSI6ImJvYiIsInJvbGVzIjpbImVkaXRvciJdLCJhdHRycyI6eyJjbGVhcmFuY2UiOjJ9LCJpYXQiOjE3NTgwOTU5NzksImV4cCI6MTc1ODA5OTU3OX0=.AaolP5mR0rUbosbJ2xfjfprDXCoTEDoZFi8KGBMcGO0="
# 查看所有文档
$response = Invoke-RestMethod -Uri "http://localhost:3000/docs" `
  -Headers @{ "Authorization" = "Bearer $TOKEN" }

$response | ConvertTo-Json -Depth 10 | Write-Output


#   新建文档
$response = Invoke-RestMethod -Uri "http://localhost:3000/docs" `
  -Method POST `
  -Headers @{
    "Authorization" = "Bearer $TOKEN"
    "Content-Type"  = "application/json"
  } `
  -Body '{"title":"new","content":"body"}'

$response | ConvertTo-Json -Depth 10 | Write-Output


#   查看单个文档
$response = Invoke-RestMethod -Uri "http://localhost:3000/docs/1" `
  -Headers @{ "Authorization" = "Bearer $TOKEN" }

$response | ConvertTo-Json -Depth 10 | Write-Output