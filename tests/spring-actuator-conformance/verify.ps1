param(
    [Parameter(Mandatory)][string]$TestBinary,
    [string]$FixtureBuild = (Join-Path $PSScriptRoot 'target'),
    [Parameter(Mandatory)][string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $TestBinary).Path
$build = (Resolve-Path -LiteralPath $FixtureBuild).Path
$classes = (Resolve-Path -LiteralPath (Join-Path $build 'classes')).Path
$dependencies = (Get-Content -LiteralPath (Join-Path $build 'runtime-classpath.txt') -Raw).Trim()
if (!$dependencies -or !(Test-Path -LiteralPath (Join-Path $classes 'studio/fixture/ActuatorFixture.class'))) {
    throw 'Compile the Spring Boot fixture and write its runtime classpath first.'
}

$javaExe = if ($env:JAVA_HOME) {
    (Resolve-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe')).Path
} else {
    (Get-Command java.exe).Source
}

$evidenceRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($EvidenceDirectory)
$run = Join-Path $evidenceRoot ("actuator-{0:N}" -f [guid]::NewGuid())
New-Item -ItemType Directory -Path $run | Out-Null
Write-Host "Evidence: $run"
$children = @{}
$environment = @{
    SPRING_APPLICATION_JSON = $null
    JAVA_TOOL_OPTIONS = $null
    JDK_JAVA_OPTIONS = $null
    _JAVA_OPTIONS = $null
    MANAGEMENT_SERVER_PORT = $null
    MANAGEMENT_SERVER_ADDRESS = $null
}

function Start-Fixture([string]$Name, [bool]$Down) {
    $launchArgs = @(
        '-cp', ('"{0};{1}"' -f $classes, $dependencies),
        'studio.fixture.ActuatorFixture',
        '--server.address=127.0.0.1',
        '--server.port=0',
        '--spring.config.location=optional:classpath:/',
        '--spring.main.banner-mode=off',
        '--spring.jmx.enabled=false',
        '--logging.level.root=WARN',
        '--management.endpoints.web.exposure.include=health,info,metrics',
        '--management.endpoints.access.max-permitted=read-only',
        "--fixture.down=$($Down.ToString().ToLowerInvariant())"
    )
    $process = Start-Process -FilePath $javaExe -ArgumentList $launchArgs -WorkingDirectory $run -Environment $environment -WindowStyle Hidden -PassThru -RedirectStandardOutput "$run/$Name.log" -RedirectStandardError "$run/$Name.err"
    $children[$Name] = @{
        Process = $process
        Started = $process.StartTime.ToUniversalTime()
    }
}

function Read-FixturePort([string]$Name) {
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($children[$Name].Process.HasExited) {
            throw "Fixture '$Name' exited. See $run/$Name.log and $run/$Name.err."
        }
        $ready = Select-String -LiteralPath "$run/$Name.log" -Pattern '^ZICODE_ACTUATOR_PORT ([0-9]+)$' | Select-Object -First 1
        if ($ready) {
            return $ready.Matches[0].Groups[1].Value
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Fixture '$Name' never reported its port. See $run/$Name.log and $run/$Name.err."
}

function Assert-Requests([string]$Name, [string[]]$Paths) {
    $actual = @(Get-Content -LiteralPath "$run/$Name.log" | Where-Object { $_ -like 'ZICODE_ACTUATOR_REQUEST *' })
    $expected = @($Paths | ForEach-Object { "ZICODE_ACTUATOR_REQUEST GET /actuator/$_ auth=false cookie=false" })
    if (($actual -join [Environment]::NewLine) -cne ($expected -join [Environment]::NewLine)) {
        throw "Unexpected requests for '$Name'. See $run/$Name.log."
    }
}

$previousUp = $env:ZICODE_ACTUATOR_UP_PORT
$previousDown = $env:ZICODE_ACTUATOR_DOWN_PORT
try {
    Start-Fixture -Name 'up' -Down $false
    Start-Fixture -Name 'down' -Down $true
    $env:ZICODE_ACTUATOR_UP_PORT = Read-FixturePort 'up'
    $env:ZICODE_ACTUATOR_DOWN_PORT = Read-FixturePort 'down'

    & $binary spring_actuator_candidate_host_tests --include-ignored --test-threads=1 --nocapture 2>&1 |
        Tee-Object -FilePath "$run/host-tests.log"
    if ($LASTEXITCODE -ne 0) {
        throw "Studio Host tests failed with exit code $LASTEXITCODE."
    }

    # The two live tests run serially against the same fixture pair.
    Assert-Requests -Name 'up' -Paths 'health', 'info', 'metrics', 'health', 'info', 'metrics'
    Assert-Requests -Name 'down' -Paths 'health', 'health'
    'Spring Boot logged exactly four confirmed GETs per candidate without credentials.'
} finally {
    $env:ZICODE_ACTUATOR_UP_PORT = $previousUp
    $env:ZICODE_ACTUATOR_DOWN_PORT = $previousDown
    foreach ($child in $children.Values) {
        $current = Get-Process -Id $child.Process.Id -ErrorAction SilentlyContinue
        if ($current -and $current.Path -eq $javaExe -and $current.StartTime.ToUniversalTime() -eq $child.Started) {
            Stop-Process -InputObject $current
            if (!$current.WaitForExit(5000)) {
                Write-Warning "Fixture $($current.Id) did not exit within five seconds."
            }
        }
    }
}
