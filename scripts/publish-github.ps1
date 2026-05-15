param(
    [ValidateSet("public", "private")]
    [string]$Visibility = "public"
)

$ErrorActionPreference = "Stop"

function Resolve-Gh {
    $command = Get-Command gh -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        "C:\Program Files\GitHub CLI\gh.exe",
        "C:\Program Files (x86)\GitHub CLI\gh.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

$gh = Resolve-Gh
if (-not $gh) {
    throw "GitHub CLI is not installed. Install it, run 'gh auth login', then re-run this script."
}

& $gh auth status

$flags = @("repo", "create", "butterclaw", "--source", ".", "--remote", "origin", "--push", "--description", "Tiny budget-first local agent runtime for low-end PCs.")
if ($Visibility -eq "public") {
    $flags += "--public"
} else {
    $flags += "--private"
}

& $gh @flags
