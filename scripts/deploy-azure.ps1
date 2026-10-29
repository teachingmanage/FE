# Azure App Service deployment for the Teaching API.
#
# Prerequisites:
#   - Azure CLI installed and logged in:  az login
#   - The connection string in $env:ConnectionStrings__Default
#   - Optionally a JWT signing key in $env:Jwt__Key (generated when missing)
#
# Usage:
#   ./scripts/deploy-azure.ps1
#   ./scripts/deploy-azure.ps1 -ResourceGroup my-rg -AppName my-app
#
# The script publishes the .NET project and uploads it as a zip, which is
# faster and more reliable than a full SDK based deployment.

param(
    [string]$ResourceGroup = "teach-manage-rg",
    [string]$AppName = "teach-manage-axb3huf0h4aaepag",
    [string]$Location = "southeastasia",
    [string]$PlanName = "teach-manage-plan",
    [string]$Sku = "B1",
    [string]$ApiProject = "C:\Users\Admin\source\repos\Teaching\Teaching"
)

$ErrorActionPreference = "Stop"

$ApiRoot = Resolve-Path $ApiProject
Write-Host "Project: $ApiRoot"

# --- 1. Build and publish -------------------------------------------------
Write-Host "`n==> Publishing the API" -ForegroundColor Cyan
$publishDir = Join-Path $ApiRoot "publish"
if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
Push-Location $ApiRoot
try {
    dotnet publish -c Release -o $publishDir --nologo
} finally {
    Pop-Location
}

# --- 2. Ensure the App Service exists ------------------------------------
Write-Host "`n==> Checking the App Service" -ForegroundColor Cyan
$exists = az webapp show --name $AppName --resource-group $ResourceGroup 2>$null
if (-not $exists) {
    Write-Host "Creating the App Service and plan..." -ForegroundColor Yellow
    az appservice plan create `
        --name $PlanName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku $Sku `
        --output none
    az webapp create `
        --name $AppName `
        --resource-group $ResourceGroup `
        --plan $PlanName `
        --runtime "DOTNETCORE|8.0" `
        --output none
} else {
    Write-Host "App Service '$AppName' already exists."
}

# --- 3. Application settings ---------------------------------------------
# The JWT signing key must be a real secret. Generate one when it was not
# supplied, and never store it in a file that is committed to the repository.
$JwtKey = $env:Jwt__Key
if ([string]::IsNullOrWhiteSpace($JwtKey)) {
    Write-Host "`n==> Generating a JWT signing key" -ForegroundColor Cyan
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    $JwtKey = [Convert]::ToBase64String($bytes)
    Write-Host "Generated a new key. Save it somewhere safe - changing it later" -ForegroundColor Yellow
    Write-Host "invalidates every existing session." -ForegroundColor Yellow
}

$conn = $env:ConnectionStrings__Default
if ([string]::IsNullOrWhiteSpace($conn)) {
    Write-Host "`nNo ConnectionStrings__Default supplied - reading it from appsettings.json" -ForegroundColor Yellow
    $conn = (Get-Content (Join-Path $ApiRoot "appsettings.json") -Raw |
        ConvertFrom-Json).ConnectionStrings.Default
}

Write-Host "`n==> Configuring application settings" -ForegroundColor Cyan
az webapp config appsettings set `
    --name $AppName `
    --resource-group $ResourceGroup `
    --settings `
    "Jwt__Key=$JwtKey" `
    "Jwt__Issuer=TeachingApi" `
    "Jwt__Audience=TeachingApp" `
    "Jwt__ExpiresHours=72" `
    "Jwt__RememberExpiresDays=365" `
    "ConnectionStrings__Default=$conn" `
    --output none

# --- 4. Upload the published app ------------------------------------------
Write-Host "`n==> Uploading the application" -ForegroundColor Cyan
$zip = Join-Path $env:TEMP "teaching-api.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $publishDir "*") -DestinationPath $zip -Force
az webapp deploy `
    --name $AppName `
    --resource-group $ResourceGroup `
    --src-path $zip `
    --type zip `
    --output none
Remove-Item $zip -Force

# --- 5. Verify ------------------------------------------------------------
Write-Host "`n==> Waiting for the app to start" -ForegroundColor Cyan
$url = "https://$AppName.azurewebsites.net"
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 6
    try {
        $r = Invoke-WebRequest -Uri "$url/health" -UseBasicParsing -TimeoutSec 20
        if ($r.StatusCode -eq 200) {
            Write-Host "API is live: $url/health" -ForegroundColor Green
            Write-Host "`nThe frontend should point at:" -ForegroundColor Green
            Write-Host "TEACHING_API_URL=$url" -ForegroundColor Green
            exit 0
        }
    } catch {
        Write-Host "  ... still starting ($($_.Exception.Message))"
    }
}

Write-Host "`nThe API did not become healthy in time. Check the logs with:" -ForegroundColor Yellow
Write-Host "  az webapp log tail --name $AppName --resource-group $ResourceGroup" -ForegroundColor Yellow
exit 1
