# ============================================================
#  织雾满穗 · 版本回退小工具
# ------------------------------------------------------------
#  网站改坏了？用它把代码退回到之前的正常版本。
#
#  原理：git revert 会生成一个「反向提交」，把某次改动原样撤销掉。
#        推送到 GitHub 之后，Cloudflare 会自动重新部署回正常版本。
#        它【不会】改写历史，所以永远安全，不会丢东西。
#
#  这个文件只是本地开发小工具，和网站本身没有关系。
#  用法：双击同目录下的 rollback.bat
# ============================================================

$ErrorActionPreference = 'Continue'
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- 找到 git ----------
$git = $null
$cands = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\git.exe'),
  'C:\Program Files\Git\bin\git.exe',
  (Join-Path ${env:ProgramFiles(x86)} 'Git\bin\git.exe')
)
foreach ($c in $cands) { if ($c -and (Test-Path $c)) { $git = $c; break } }
if (-not $git) {
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { $git = $cmd.Source }
}
if (-not $git) {
  Write-Host "找不到 git，请先安装 Git for Windows。" -ForegroundColor Red
  Read-Host "按回车键退出"
  exit 1
}

# ---------- 切到项目根目录（本脚本的上一级） ----------
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root '.git'))) {
  Write-Host "这个脚本要放在项目根目录下面的 tools 文件夹里。" -ForegroundColor Red
  Read-Host "按回车键退出"
  exit 1
}
Set-Location $root

# 不让 git 在终端里等待输入（登录交给 GitHub 凭据管理器弹窗）
$env:GIT_TERMINAL_PROMPT = '0'

# ---------- 小工具 ----------
# 注意：这里不能用 ValueFromRemainingArguments —— 那会把传进来的数组
# 再包一层，git 收到的是一个"连在一起"的参数，根本执行不了。
function Git {
  param([string[]]$a)
  & $git @a 2>&1
}

# git 的 stdout/stderr 混在 2>&1 里时可能夹着 ErrorRecord，统一转成字符串再用
function Get-GitLines {
  param([string[]]$a)
  return @(Git $a | ForEach-Object { "$_" } | Where-Object { $_ -match '\S' })
}

function Pause-Key {
  Write-Host ""
  Read-Host "按回车键返回菜单" | Out-Null
}

function Do-Push {
  Write-Host ""
  Write-Host "正在推送到 GitHub ..." -ForegroundColor Cyan
  $out = Git @('push', 'origin', 'main')
  $out | ForEach-Object { "  $_" }
  if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ 推送成功！Cloudflare 会在 1 分钟内自动重新部署。" -ForegroundColor Green
    Write-Host "   想确认的话：Cloudflare 面板 → Workers & Pages → 你的项目 → Deployments" -ForegroundColor DarkGray
  } else {
    Write-Host ""
    Write-Host "❌ 推送失败。" -ForegroundColor Red
    Write-Host "   如果这是第一次推送，可能会弹出 GitHub 登录窗口；登录完成后再试一次。" -ForegroundColor Yellow
  }
}

function Show-Commits {
  param([int]$Count = 15)
  $lines = Get-GitLines @('--no-pager', 'log', '--oneline', "-$Count")
  Write-Host ""
  Write-Host "最近的提交（【1】是最新的）：" -ForegroundColor Cyan
  Write-Host ""
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = [string]$lines[$i]
    $sha = ($line -split ' ')[0]
    $msg = $line.Substring($sha.Length).Trim()
    Write-Host ("  [{0,2}]  {1}  {2}" -f ($i + 1), $sha, $msg)
  }
  return $lines
}

function Show-Tags {
  $tags = Get-GitLines @('tag', '-l', '--sort=-creatordate')
  Write-Host ""
  if ($tags.Count -eq 0) {
    Write-Host "（还没有安全点。建议在每次大改动前用菜单【5】打一个。）" -ForegroundColor DarkGray
    return @()
  }
  Write-Host "已有的安全点（【1】是最新的）：" -ForegroundColor Cyan
  Write-Host ""
  for ($i = 0; $i -lt $tags.Count; $i++) {
    $when = (Get-GitLines @('log', '-1', '--format=%cd', '--date=short', [string]$tags[$i])) -join ''
    Write-Host ("  [{0,2}]  {1}   ({2})" -f ($i + 1), $tags[$i], $when.Trim())
  }
  return $tags
}

function Revert-One {
  param([string]$Sha, [string]$Label)

  Write-Host ""
  Write-Host "即将撤销这一次改动：" -ForegroundColor Yellow
  Write-Host "    $Sha  $Label" -ForegroundColor Yellow
  $ans = Read-Host "确认吗？输入 y 继续，其它任意键取消"
  if ($ans -ne 'y' -and $ans -ne 'Y') { Write-Host "已取消，什么都没做。"; return }

  Write-Host ""
  $out = Git @('revert', '--no-edit', $Sha)
  $out | ForEach-Object { "  $_" }
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ 撤销时发生冲突，需要人工处理。" -ForegroundColor Red
    Write-Host "   把上面这段提示发给 AI 助手即可。" -ForegroundColor Yellow
    Write-Host "   想放弃这次撤销、恢复原样：执行  git revert --abort" -ForegroundColor DarkGray
    return
  }
  Write-Host "✅ 本地已经撤销。" -ForegroundColor Green
  Do-Push
}

# ---------- 菜单动作 ----------
function Act-History {
  Show-Commits 15 | Out-Null
  Show-Tags | Out-Null
  Pause-Key
}

function Act-UndoLast {
  $lines = Get-GitLines @('--no-pager', 'log', '--oneline', '-2')
  if ($lines.Count -lt 2) {
    Write-Host "只有一次提交，没有可以撤销的上一次。" -ForegroundColor Yellow
    Pause-Key
    return
  }
  $line = [string]$lines[0]
  $sha = ($line -split ' ')[0]
  $msg = $line.Substring($sha.Length).Trim()
  Revert-One -Sha $sha -Label $msg
  Pause-Key
}

function Act-UndoPick {
  $lines = Show-Commits 15
  $sel = Read-Host "输入要撤销的编号（直接回车取消）"
  if ([string]::IsNullOrWhiteSpace($sel)) { return }
  $n = 0
  if (-not [int]::TryParse($sel.Trim(), [ref]$n)) { Write-Host "输入的不是数字。" -ForegroundColor Red; Pause-Key; return }
  if ($n -lt 1 -or $n -gt $lines.Count) { Write-Host "编号超范围。" -ForegroundColor Red; Pause-Key; return }
  if ($n -eq $lines.Count) {
    Write-Host "最后一次提交没有父提交，无法单独撤销。" -ForegroundColor Yellow
    Pause-Key
    return
  }
  $line = [string]$lines[$n - 1]
  $sha = ($line -split ' ')[0]
  $msg = $line.Substring($sha.Length).Trim()
  Revert-One -Sha $sha -Label $msg
  Pause-Key
}

function Act-RestoreTag {
  $tags = Show-Tags
  if ($tags.Count -eq 0) { Pause-Key; return }
  $sel = Read-Host "输入编号，整体回到那个安全点（直接回车取消）"
  if ([string]::IsNullOrWhiteSpace($sel)) { return }
  $n = 0
  if (-not [int]::TryParse($sel.Trim(), [ref]$n)) { Write-Host "输入的不是数字。" -ForegroundColor Red; Pause-Key; return }
  if ($n -lt 1 -or $n -gt $tags.Count) { Write-Host "编号超范围。" -ForegroundColor Red; Pause-Key; return }

  $tag = [string]$tags[$n - 1]
  $range = "$tag..HEAD"
  $count = ((Get-GitLines @('rev-list', '--count', $range)) -join '').Trim()
  if ($count -eq '0') {
    Write-Host "当前代码已经就是这个安全点的状态了，不用回退。" -ForegroundColor Green
    Pause-Key
    return
  }
  Write-Host ""
  Write-Host "会把 $tag 之后的 $count 次改动【整体撤销】，回到当时的样子。" -ForegroundColor Yellow
  $ans = Read-Host "确认吗？输入 y 继续"
  if ($ans -ne 'y' -and $ans -ne 'Y') { Write-Host "已取消。"; Pause-Key; return }

  $out = Git @('revert', '--no-edit', $range)
  $out | ForEach-Object { "  $_" }
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "❌ 撤销时发生冲突，需要人工处理（把这段发给 AI 助手）。" -ForegroundColor Red
    Write-Host "   想放弃：执行  git revert --abort" -ForegroundColor DarkGray
    Pause-Key
    return
  }
  Write-Host "✅ 本地已回到该安全点。" -ForegroundColor Green
  Do-Push
  Pause-Key
}

function Act-Checkpoint {
  $default = 'good-' + (Get-Date -Format 'yyyyMMdd-HHmm')
  Write-Host ""
  $name = Read-Host "给这个安全点起个名字（直接回车用 $default）"
  if ([string]::IsNullOrWhiteSpace($name)) { $name = $default }
  $name = ($name.Trim() -replace '\s+', '-')

  $out = Git @('tag', $name)
  $out | ForEach-Object { "  $_" }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 创建失败，可能这个名字已经用过了。" -ForegroundColor Red
    Pause-Key
    return
  }
  Write-Host "✅ 本地安全点已创建：$name" -ForegroundColor Green
  Write-Host "正在同步到 GitHub ..." -ForegroundColor Cyan
  $out2 = Git @('push', 'origin', $name)
  $out2 | ForEach-Object { "  $_" }
  if ($LASTEXITCODE -eq 0) { Write-Host "✅ 已同步。以后随时可以回到这个状态。" -ForegroundColor Green }
  Pause-Key
}

function Act-CommitPush {
  Write-Host ""
  $st = Get-GitLines @('status', '--short')
  if ($st.Count -eq 0) {
    Write-Host "本地没有任何改动，直接推送一次看看。" -ForegroundColor DarkGray
    Do-Push
    Pause-Key
    return
  }
  Write-Host "检测到这些改动：" -ForegroundColor Cyan
  $st | ForEach-Object { "  $_" }
  Write-Host ""
  $msg = Read-Host "写一句这次改了什么（直接回车用默认说明）"
  if ([string]::IsNullOrWhiteSpace($msg)) { $msg = '更新网站内容 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') }

  Git @('add', '-A') | Out-Null
  $out = Git @('commit', '-m', $msg.Trim())
  $out | ForEach-Object { "  $_" }
  if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 提交失败。" -ForegroundColor Red
    Pause-Key
    return
  }
  Write-Host "✅ 已在本地提交。" -ForegroundColor Green
  Do-Push
  Pause-Key
}

function Act-Pull {
  Write-Host ""
  Write-Host "正在从 GitHub 拉取最新代码 ..." -ForegroundColor Cyan
  $out = Git @('pull', '--ff-only', 'origin', 'main')
  $out | ForEach-Object { "  $_" }
  if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ 已是最新。" -ForegroundColor Green
  } else {
    Write-Host "❌ 拉取失败。可能是本地有改动没提交，或者本地和远端分叉了。" -ForegroundColor Red
    Write-Host "   把这段提示发给 AI 助手处理最稳妥。" -ForegroundColor Yellow
  }
  Pause-Key
}

# ---------- 主循环 ----------
while ($true) {
  Clear-Host
  $head = (Get-GitLines @('log', '-1', '--format=%h  %s')) -join ''
  $branch = (Get-GitLines @('rev-parse', '--abbrev-ref', 'HEAD')) -join ''

  Write-Host "============================================================" -ForegroundColor Magenta
  Write-Host "   织雾满穗 · 版本回退小工具" -ForegroundColor Magenta
  Write-Host "============================================================" -ForegroundColor Magenta
  Write-Host ("   当前分支：{0}" -f $branch.Trim()) -ForegroundColor DarkGray
  Write-Host ("   最新提交：{0}" -f $head.Trim()) -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "   【1】查看历史（最近提交 + 安全点）"
  Write-Host "   【2】撤销最近一次提交            " -NoNewline; Write-Host "← 刚推的那版坏了，用这个" -ForegroundColor Green
  Write-Host "   【3】撤销指定的某一次提交"
  Write-Host "   【4】整体回到某个安全点"
  Write-Host "   【5】打一个安全点（保存当前状态）"
  Write-Host "   【6】把本地改动提交并推送"
  Write-Host "   【7】从 GitHub 拉取最新代码"
  Write-Host "   【0】退出"
  Write-Host ""
  Write-Host "   提示：Cloudflare 面板的 Deployments 里有「Rollback to this" -ForegroundColor DarkGray
  Write-Host "   deployment」，几秒钟就能把线上切回旧版，应急最快。" -ForegroundColor DarkGray
  Write-Host "============================================================" -ForegroundColor Magenta

  $choice = Read-Host "请输入编号"

  switch ($choice.Trim()) {
    '1' { Act-History }
    '2' { Act-UndoLast }
    '3' { Act-UndoPick }
    '4' { Act-RestoreTag }
    '5' { Act-Checkpoint }
    '6' { Act-CommitPush }
    '7' { Act-Pull }
    '0' { Write-Host "再见！" -ForegroundColor Green; exit 0 }
    default { }
  }
}
