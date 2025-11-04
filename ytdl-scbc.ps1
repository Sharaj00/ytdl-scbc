param(
    [string]$url,
    [switch]$install,
    [switch]$uninstall,
    [switch]$check
)

$ErrorActionPreference = 'Stop'

# Protocol registration
if ($install) {
    $scriptPath = $MyInvocation.MyCommand.Path
    if (-not $scriptPath) {
        Write-Host "Error: Failed to determine script path" -ForegroundColor Red
        exit 1
    }
    
    try {
        # Remove old registration first to ensure clean install
        if (Test-Path "HKCU:\Software\Classes\ytdl") {
            Remove-Item -Path "HKCU:\Software\Classes\ytdl" -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "Removed old protocol registration..." -ForegroundColor Yellow
        }
        
        # Create new registration
        New-Item -Path "HKCU:\Software\Classes\ytdl" -Force | Out-Null
        Set-ItemProperty -Path "HKCU:\Software\Classes\ytdl" -Name "(Default)" -Value "URL:ytdl Protocol"
        Set-ItemProperty -Path "HKCU:\Software\Classes\ytdl" -Name "URL Protocol" -Value ""
        New-Item -Path "HKCU:\Software\Classes\ytdl\shell\open\command" -Force | Out-Null
        
        $commandLine = 'powershell.exe -NoExit -File "' + $scriptPath + '" "%1"'
        Set-ItemProperty -Path "HKCU:\Software\Classes\ytdl\shell\open\command" -Name "(Default)" -Value $commandLine
        
        # Verify registration
        $registeredPath = (Get-ItemProperty -Path "HKCU:\Software\Classes\ytdl\shell\open\command" -Name "(Default)").'(Default)'
        
        Write-Host "Protocol ytdl:// successfully registered!" -ForegroundColor Green
        Write-Host "Registered command: $registeredPath" -ForegroundColor Gray
        Write-Host "Script path: $scriptPath" -ForegroundColor Gray
        
        if ($registeredPath -ne $commandLine) {
            Write-Host "Warning: Registered command doesn't match expected value!" -ForegroundColor Yellow
            exit 1
        }
        
        exit 0
    } catch {
        Write-Host "Error registering protocol: $_" -ForegroundColor Red
        exit 1
    }
}

# Check current protocol registration
if ($check) {
    Write-Host "`n=== Current Protocol Registration ===" -ForegroundColor Cyan
    if (Test-Path "HKCU:\Software\Classes\ytdl") {
        $protocolName = (Get-ItemProperty -Path "HKCU:\Software\Classes\ytdl" -Name "(Default)" -ErrorAction SilentlyContinue).'(Default)'
        Write-Host "Protocol name: $protocolName" -ForegroundColor Gray
        
        if (Test-Path "HKCU:\Software\Classes\ytdl\shell\open\command") {
            $command = (Get-ItemProperty -Path "HKCU:\Software\Classes\ytdl\shell\open\command" -Name "(Default)" -ErrorAction SilentlyContinue).'(Default)'
            Write-Host "Registered command: $command" -ForegroundColor Gray
            
            if ($command -match 'yt-download\.ps1') {
                Write-Host "`nWARNING: Old script name detected in registration!" -ForegroundColor Red
                Write-Host "Please run: .\ytdl-scbc.ps1 -uninstall" -ForegroundColor Yellow
                Write-Host "Then run: .\ytdl-scbc.ps1 -install" -ForegroundColor Yellow
            } else {
                Write-Host "`nRegistration looks correct" -ForegroundColor Green
            }
        } else {
            Write-Host "Command not registered" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Protocol not registered" -ForegroundColor Yellow
    }
    Write-Host "=====================================`n" -ForegroundColor Cyan
    exit 0
}

# Protocol unregistration
if ($uninstall) {
    try {
        # Remove protocol registration
        $removed = $false
        if (Test-Path "HKCU:\Software\Classes\ytdl") {
            Remove-Item -Path "HKCU:\Software\Classes\ytdl" -Recurse -Force -ErrorAction Stop
            $removed = $true
            Write-Host "Protocol ytdl:// registration removed from HKCU:\Software\Classes\ytdl" -ForegroundColor Green
        }
        
        # Also check and clean any old registrations
        $oldPaths = @(
            "HKCU:\Software\Classes\ytdl\shell\open\command"
        )
        foreach ($oldPath in $oldPaths) {
            if (Test-Path $oldPath) {
                Remove-Item -Path $oldPath -Recurse -Force -ErrorAction SilentlyContinue
                Write-Host "Removed old path: $oldPath" -ForegroundColor Yellow
            }
        }
        
        if ($removed) {
            Write-Host "`nProtocol ytdl:// successfully removed!" -ForegroundColor Green
        } else {
            Write-Host "`nNo protocol registration found to remove." -ForegroundColor Yellow
        }
        exit 0
    } catch {
        Write-Host "Error removing protocol: $_" -ForegroundColor Red
        exit 1
    }
}

# Download processing
if (-not $url) { exit 1 }

if ($url -match "^ytdl:\?(.*)") {
    $queryString = $matches[1]
} else {
    exit 1
}

$parameters = @{}
foreach ($pair in $queryString -split '&') {
    $kv = $pair -split '=',2
    if ($kv.Length -eq 2) {
        # Use PowerShell's built-in URL decoding
        try {
            $decodedValue = [System.Uri]::UnescapeDataString($kv[1])
            $parameters[$kv[0]] = $decodedValue
        } catch {
            # Fallback if decoding fails
            $parameters[$kv[0]] = $kv[1]
        }
    }
}

if (-not $parameters.ContainsKey('url')) { exit 1 }

$dlUrl   = if ($parameters.ContainsKey('url')) { $parameters['url'].Trim() } else { "" }
$template = if ($parameters.ContainsKey('template')) { $parameters['template'].Trim() } else { "" }
$output  = if ($parameters.ContainsKey('output')) { $parameters['output'].Trim() } else { '.\%(title)s.%(ext)s' }
$customParams = if ($parameters.ContainsKey('custom')) { $parameters['custom'].Trim() } else { "" }
$embedThumbnail = if ($parameters.ContainsKey('embedThumbnail') -and $parameters['embedThumbnail'] -eq 'true') { "--embed-thumbnail" } else { "" }
$addMetadata = if ($parameters.ContainsKey('addMetadata') -and $parameters['addMetadata'] -eq 'true') { "--add-metadata" } else { "" }
$noOverwrites = if ($parameters.ContainsKey('noOverwrites') -and $parameters['noOverwrites'] -eq 'true') { "--no-overwrites" } else { "" }

# Process cookies from data
$cookiesFile = $null
if ($parameters.ContainsKey('cookiesData') -and $parameters['cookiesData']) {
    try {
        # Decode base64
        $cookiesBase64 = $parameters['cookiesData']
        $cookiesBytes = [System.Convert]::FromBase64String($cookiesBase64)
        $cookiesContent = [System.Text.Encoding]::UTF8.GetString($cookiesBytes)
        
        # Create temporary file for cookies
        $tempDir = [System.IO.Path]::GetTempPath()
        $cookiesFile = Join-Path $tempDir "ytdl_cookies_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"
        
        # Ensure proper line endings (Unix-style \n) and save without BOM
        # Netscape format requires LF line endings
        $cookiesContent = $cookiesContent -replace "`r`n", "`n" -replace "`r", "`n"
        # Save as ASCII/UTF8 without BOM for proper Netscape format
        [System.IO.File]::WriteAllText($cookiesFile, $cookiesContent, [System.Text.UTF8Encoding]::new($false))
        
        Write-Host "Cookies saved to: $cookiesFile" -ForegroundColor Green
    } catch {
        Write-Host "Error processing cookies: $_" -ForegroundColor Red
        $cookiesFile = $null
    }
}

if (-not (Get-Command yt-dlp -ErrorAction SilentlyContinue)) { exit 1 }

# Initialize statistics variables (must be before try block)
$script:successCount = 0
$script:errorCount = 0
$script:errors = @()
$script:downloadedFiles = @()
$script:currentFile = $null

# Get track information before downloading
Write-Host "`n=== Download Information ===" -ForegroundColor Cyan
Write-Host "URL: $dlUrl" -ForegroundColor Gray
Write-Host "Output: $output" -ForegroundColor Gray
if ($template) { Write-Host "Format: $template" -ForegroundColor Gray }
if ($cookiesFile) { Write-Host "Using cookies: Yes" -ForegroundColor Gray }
Write-Host "=============================`n" -ForegroundColor Cyan

# Check that URL is not empty
if ([string]::IsNullOrWhiteSpace($dlUrl)) {
    Write-Host "Error: URL is empty or null" -ForegroundColor Red
    exit 1
}

# Build arguments array correctly
$argsArray = @()
if ($template) { 
    # Split template into separate arguments (e.g. "-f b " -> "-f", "b")
    $templateParts = $template.Trim() -split '\s+'
    $argsArray += $templateParts | Where-Object { $_ }
}
if ($embedThumbnail) { $argsArray += "--embed-thumbnail" }
if ($addMetadata) { $argsArray += "--add-metadata" }
if ($noOverwrites) { $argsArray += "--no-overwrites" }
if ($cookiesFile) { 
    $argsArray += "--cookies"
    $argsArray += $cookiesFile
}
if ($customParams) {
    # Split custom parameters into separate arguments
    $customParts = $customParams.Trim() -split '\s+' | Where-Object { $_ }
    $argsArray += $customParts
}
# Silent mode with progress bar: --quiet removes extra output, but --progress shows progress
# --no-warnings removes warnings, but errors remain
# IMPORTANT: argument order - first all options, then -o with path, then URL
$argsArray += "--quiet", "--no-warnings", "--progress", "--newline", "--console-title"
$argsArray += "-o"
# Add path as-is - Start-Process with array argument correctly handles spaces and special characters
$argsArray += $output
$argsArray += $dlUrl

Write-Host "Starting download...`n" -ForegroundColor Yellow

# Run yt-dlp with output capture
try {
    # Use simpler approach - run via Start-Process
    # but capture output line by line
    # Use TEMP folder for temporary files
    $tempDir = [System.IO.Path]::GetTempPath()
    $stdoutFile = Join-Path $tempDir "ytdlp_stdout_$PID.txt"
    $stderrFile = Join-Path $tempDir "ytdlp_stderr_$PID.txt"
    
    # Debug information for diagnostics
    Write-Host "Debug: Arguments count: $($argsArray.Count)" -ForegroundColor DarkGray
    Write-Host "Debug: Output path: $output" -ForegroundColor DarkGray
    Write-Host "Debug: Download URL: $dlUrl" -ForegroundColor DarkGray
    
    # Ensure URL and output are not empty and correctly positioned
    if ([string]::IsNullOrWhiteSpace($dlUrl)) {
        Write-Host "Error: Download URL is empty!" -ForegroundColor Red
        exit 1
    }
    if ([string]::IsNullOrWhiteSpace($output)) {
        Write-Host "Error: Output path is empty!" -ForegroundColor Red
        exit 1
    }
    
    # Build argument string with proper escaping
    # Use cmd.exe for reliable output redirection to files
    $argumentsList = @()
    foreach ($arg in $argsArray) {
        # If argument contains spaces, quotes or special characters, wrap in quotes
        # Check if argument needs quoting
        $needsQuoting = $false
        if ($arg -match '\s') { $needsQuoting = $true }
        if ($arg -match '"') { $needsQuoting = $true }
        if ($arg.Contains('%')) { $needsQuoting = $true }
        if ($arg.Contains('!')) { $needsQuoting = $true }
        
        if ($needsQuoting) {
            # Escape quotes inside argument (double them for Windows command line)
            $escapedArg = $arg.Replace('"', '""')
            $argumentsList += '"' + $escapedArg + '"'
        } else {
            $argumentsList += $arg
        }
    }
    $argumentsString = $argumentsList -join ' '
    
    # Escape output file paths for cmd.exe (double quotes for cmd.exe)
    $stdoutFileEscaped = $stdoutFile.Replace('"', '""')
    $stderrFileEscaped = $stderrFile.Replace('"', '""')
    
    # Use cmd.exe for launch with output redirection
    # This ensures correct processing of all arguments, including paths with spaces
    $cmdCommand = 'yt-dlp ' + $argumentsString + ' > "' + $stdoutFileEscaped + '" 2> "' + $stderrFileEscaped + '"'
    $cmdArgs = @(
        "/c"
        $cmdCommand
    )
    
    Write-Host "Debug: Command: cmd.exe /c $cmdCommand" -ForegroundColor DarkGray
    
    # Run via cmd.exe for reliable output redirection
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList $cmdArgs -NoNewWindow -PassThru
    
    # Variables for progress tracking
    $script:downloadedFiles = @()
    $script:currentFile = $null
    
    # Read output in real time
    $lastStdoutPos = 0
    $lastStderrPos = 0
    $lastProgressLine = ""
    
    while (-not $process.HasExited) {
        Start-Sleep -Milliseconds 100
        
        # Read new lines from stdout (progress and information)
        if (Test-Path $stdoutFile) {
            try {
                $content = Get-Content $stdoutFile -Raw -ErrorAction SilentlyContinue
                if ($content -and $content.Length -gt $lastStdoutPos) {
                    $newContent = $content.Substring($lastStdoutPos)
                    $lines = $newContent -split "`r?`n"
                    foreach ($line in $lines) {
                        $line = $line.Trim()
                        if ($line) {
                            # Parse yt-dlp progress bar
                            # Format: [download] XX.X% of YYY at ZZZ/s ETA MM:SS
                            if ($line -match '\[download\]\s+(\d+\.?\d*)%') {
                                $percent = $matches[1]
                                # Extract additional information
                                $sizeInfo = ""
                                $speedInfo = ""
                                $etaInfo = ""
                                
                                if ($line -match 'of\s+([\d.]+)\s*([KMGT]?i?B)') {
                                    $sizeInfo = "$($matches[1]) $($matches[2])"
                                }
                                if ($line -match 'at\s+([\d.]+)\s*([KMGT]?i?B/s)') {
                                    $speedInfo = "$($matches[1]) $($matches[2])/s"
                                }
                                if ($line -match 'ETA\s+(\d{2}:\d{2})') {
                                    $etaInfo = "ETA: $($matches[1])"
                                }
                                
                                # Build compact progress string
                                $progressParts = @()
                                $progressParts += "Progress: $percent%"
                                if ($sizeInfo) { $progressParts += "Size: $sizeInfo" }
                                if ($speedInfo) { $progressParts += "Speed: $speedInfo" }
                                if ($etaInfo) { $progressParts += $etaInfo }
                                
                                $progressText = $progressParts -join ' | '
                                
                                # Update progress line (overwrite previous)
                                $carriageReturn = [char]13
                                $progressLine = $carriageReturn + $progressText
                                Write-Host $progressLine -NoNewline
                                $lastProgressLine = $progressText
                                
                                # If 100%, file is downloaded
                                if ($percent -eq "100") {
                                    Write-Host "" # New line after 100%
                                    $script:successCount++
                                }
                            }
                            # Information about file download start
                            elseif ($line -match '\[download\]\s+Destination:\s*(.+)') {
                                $script:currentFile = $matches[1]
                                Write-Host "`nDownloading: $($script:currentFile)" -ForegroundColor Cyan
                            }
                            # Information about download completion
                            elseif ($line -match '\[download\]\s+100%\s+of\s+[\d.]+\s*[KMGT]?i?B') {
                                Write-Host "" # New line after completion
                                if ($script:currentFile) {
                                    $script:downloadedFiles += $script:currentFile
                                    $script:currentFile = $null
                                }
                                $script:successCount++
                            }
                            # Errors
                            elseif ($line -match 'ERROR|Failed') {
                                Write-Host "`n$line" -ForegroundColor Red
                                $script:errorCount++
                                $script:errors += $line
                            }
                            # Other information (ignored in silent mode)
                        }
                    }
                    $lastStdoutPos = $content.Length
                }
            } catch { }
        }
        
        # Read new lines from stderr (errors and critical messages)
        if (Test-Path $stderrFile) {
            try {
                $content = Get-Content $stderrFile -Raw -ErrorAction SilentlyContinue
                if ($content -and $content.Length -gt $lastStderrPos) {
                    $newContent = $content.Substring($lastStderrPos)
                    $lines = $newContent -split "`r?`n"
                    foreach ($line in $lines) {
                        $line = $line.Trim()
                        if ($line) {
                            # In silent mode show only errors
                            if ($line -match 'ERROR|Failed|Exception') {
                                Write-Host "`n$line" -ForegroundColor Red
                                $script:errorCount++
                                $script:errors += $line
                            }
                        }
                    }
                    $lastStderrPos = $content.Length
                }
            } catch { }
        }
    }
    
    # Clear last progress line
    if ($lastProgressLine) {
        Write-Host "" # New line after completion
    }
    
    # Wait for completion and read remaining output
    $process.WaitForExit()
    $exitCode = $process.ExitCode
    if ($null -eq $exitCode) { $exitCode = 0 }
    
    # Read final output to account for all completed downloads
    if (Test-Path $stdoutFile) {
        $finalOutput = Get-Content $stdoutFile -ErrorAction SilentlyContinue
        $finalOutput | ForEach-Object {
            if ($_ -match '\[download\]\s+100%' -and $script:downloadedFiles -notcontains $_) {
                # Already counted in loop, but check again
                if ($script:successCount -eq 0) {
                    $script:successCount++
                }
            } elseif ($_ -match 'ERROR|Failed') {
                $script:errorCount++
                $script:errors += $_
            }
        }
    }
    
    if (Test-Path $stderrFile) {
        $finalError = Get-Content $stderrFile -ErrorAction SilentlyContinue
        $finalError | ForEach-Object {
            if ($_ -match 'ERROR|Failed|Exception') {
                $script:errorCount++
                $script:errors += $_
            }
        }
    }
    
    # Remove temporary files
    Remove-Item $stdoutFile -ErrorAction SilentlyContinue
    Remove-Item $stderrFile -ErrorAction SilentlyContinue
    
    # If process exited with error
    if ($exitCode -ne 0) {
        $script:errorCount++
        $script:errors += "yt-dlp exited with code $exitCode"
    }
    
    # If nothing was downloaded but no errors, consider it success
    if ($script:successCount -eq 0 -and $script:errorCount -eq 0 -and $exitCode -eq 0) {
        $script:successCount = 1
    }
    
} catch {
    Write-Host "Error executing yt-dlp: $_" -ForegroundColor Red
    $script:errorCount++
    $script:errors += "Execution error: $_"
} finally {
    # Remove temporary cookies file after completion
    if ($cookiesFile -and (Test-Path $cookiesFile)) {
        Remove-Item $cookiesFile -Force -ErrorAction SilentlyContinue
    }
    
    # Display statistics
    Write-Host "`n=== Download Statistics ===" -ForegroundColor Cyan
    if ($script:successCount -gt 0) {
        Write-Host "Successfully downloaded: $script:successCount file(s)" -ForegroundColor Green
        if ($script:downloadedFiles.Count -gt 0) {
            Write-Host "`nDownloaded files:" -ForegroundColor Gray
            $script:downloadedFiles | ForEach-Object {
                $fileName = Split-Path $_ -Leaf
                Write-Host "  - $fileName" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "No files downloaded" -ForegroundColor Yellow
    }
    if ($script:errorCount -gt 0) {
        Write-Host "`nErrors: $script:errorCount" -ForegroundColor Red
        Write-Host "Error details:" -ForegroundColor Yellow
        $script:errors | Select-Object -Unique | ForEach-Object { 
            Write-Host "  - $_" -ForegroundColor Red 
        }
    }
    Write-Host "===========================`n" -ForegroundColor Cyan
    
    # Pause console to see errors/statistics before closing
    if ($script:errorCount -gt 0) {
        Write-Host "Press Enter to close..." -ForegroundColor Yellow
        try {
            # Try ReadKey first (works in interactive console)
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        } catch {
            # Fallback to Read-Host if ReadKey doesn't work (e.g., when launched via protocol)
            Read-Host
        }
    } else {
        # Short delay before closing on success (2 seconds)
        Start-Sleep -Seconds 2
    }
}

