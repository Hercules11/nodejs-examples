$response = Invoke-RestMethod -Uri "http://localhost:3000/login" `
  -Method POST `
  -Headers @{ "Content-Type" = "application/json" } `
  -Body '{"username":"bob","password":"password2"}'

$TOKEN = $response.token
Write-Host "Your token is: $TOKEN"