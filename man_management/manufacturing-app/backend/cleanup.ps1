# Cleanup script - deletes debug and test files added during development
$pwd = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $pwd
    # Cleanup script - deletes debug and test files and removes empty/whitespace-only files
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    Set-Location $scriptDir

    $toRemove = @(
  'backend.log',
  'call_sample.py',
  'check_cors.py',
  'debug_api.py',
  'diagnose_db.py',
  'export_test.py',
  'list_routes.py',
  'mo_test_export.xlsx',
  'test_api_calls.py'
)

foreach($f in $toRemove){
  if(Test-Path $f){
    Write-Host "Removing $f"
    Remove-Item $f -Force -ErrorAction SilentlyContinue
  }
}

# remove tests folder
    # remove tests folder and __pycache__ if present
    if(Test-Path "tests"){ Remove-Item tests -Recurse -Force -ErrorAction SilentlyContinue; Write-Host "Removed tests/" }
    if(Test-Path "__pycache__"){ Remove-Item __pycache__ -Recurse -Force -ErrorAction SilentlyContinue; Write-Host "Removed __pycache__/" }

    # Sweep backend and frontend for files that are zero bytes or contain only whitespace
    $scanDirs = @('.', '..\frontend')
    foreach($d in $scanDirs){
      if(Test-Path $d){
        Write-Host "Scanning $d for empty or whitespace-only files..."
        Get-ChildItem -Path $d -Recurse -File | ForEach-Object {
          $path = $_.FullName
          $size = 0
          try{ $size = (Get-Item -LiteralPath $path).Length } catch {}
          if($size -eq 0){
            Write-Host "Removing zero-byte file: $path"
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
            return
          }
          # Check for whitespace-only content
          try{
            $content = Get-Content -Raw -ErrorAction Stop -LiteralPath $path
          }catch{ $content = $null }
          if($null -eq $content -or $content.Trim().Length -eq 0){
            Write-Host "Removing whitespace-only file: $path"
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
          }
        }
      }
    }

    Write-Host "Cleanup complete. Please verify the remaining files." 

Write-Host "Cleanup complete. Please verify the remaining files." 