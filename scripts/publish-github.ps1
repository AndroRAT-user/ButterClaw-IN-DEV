param(
    [ValidateSet("public", "private")]
    [string]$Visibility = "public"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI is not installed. Install it, run 'gh auth login', then re-run this script."
}

gh auth status

$flags = @("repo", "create", "butterclaw", "--source", ".", "--remote", "origin", "--push", "--description", "Tiny budget-first local agent runtime for low-end PCs.")
if ($Visibility -eq "public") {
    $flags += "--public"
} else {
    $flags += "--private"
}

gh @flags

