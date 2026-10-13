$body = @{
    update_id = 999999992
    message = @{
        message_id = 100
        from = @{
            id = 1009092211
            is_bot = $false
            first_name = "User"
        }
        chat = @{
            id = 1009092211
            type = "private"
        }
        date = [int][double]::Parse((Get-Date -UFormat %s))
        text = "bensin motor 25rb"
    }
} | ConvertTo-Json -Depth 5

$res = Invoke-WebRequest -Uri "https://bot-tele-topaz.vercel.app/api/webhook" -Method POST -Body $body -ContentType "application/json"
Write-Host "STATUS:" $res.StatusCode
