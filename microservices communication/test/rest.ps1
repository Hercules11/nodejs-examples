Write-Host "== GET /hello =="
Invoke-RestMethod -Uri "http://localhost:3000/hello" -Method Get | ConvertTo-Json

Write-Host "`n== POST /echo =="
Invoke-RestMethod -Uri "http://localhost:3000/echo" -Method Post -Body (@{name="wxc"} | ConvertTo-Json) -ContentType "application/json" | ConvertTo-Json
