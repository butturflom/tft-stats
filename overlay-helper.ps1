# TFT Stats : pilote la fenetre de l'overlay (premier plan, transparence, forme, taille, deplacement).
# Lance une seule fois par l'application ; recoit une commande par ligne sur l'entree standard.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class TftHud {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; public POINT(int x, int y) { X = x; Y = y; } }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint k, byte a, uint f);
  [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h, IntPtr r, bool redraw);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("gdi32.dll")] public static extern IntPtr CreatePolygonRgn(POINT[] p, int n, int mode);
  [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s);
  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
      if (sb.ToString().StartsWith(title)) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
# Coordonnees en vrais pixels de l'ecran (la page envoie ses mesures multipliees par l'echelle d'affichage)
try { if (-not [TftHud]::SetProcessDpiAwarenessContext([IntPtr](-4))) { [TftHud]::SetProcessDPIAware() | Out-Null } } catch { [TftHud]::SetProcessDPIAware() | Out-Null }

$script:h = [IntPtr]::Zero
$script:styled = [IntPtr]::Zero
$script:alpha = 200
$script:start = $null
function Get-Hud {
  if ($script:h -ne [IntPtr]::Zero -and [TftHud]::IsWindow($script:h)) { return $script:h }
  $script:h = [TftHud]::Find('TFT Overlay')
  return $script:h
}
function Set-Style($h) {
  # Toujours au premier plan, translucide
  [TftHud]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0013) | Out-Null
  $ex = [TftHud]::GetWindowLong($h, -20)
  [TftHud]::SetWindowLong($h, -20, ($ex -bor 0x80000)) | Out-Null
  [TftHud]::SetLayeredWindowAttributes($h, 0, [byte]$script:alpha, 0x2) | Out-Null
  # Pas d'ombre ni d'arrondi de Windows 11 : la forme vient de la page
  $v = 1; [TftHud]::DwmSetWindowAttribute($h, 33, [ref]$v, 4) | Out-Null
  $script:styled = $h
}
function Ready {
  $h = Get-Hud
  if ($h -eq [IntPtr]::Zero) { return [IntPtr]::Zero }
  if ($script:styled -ne $h) { Set-Style $h }
  return $h
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $a = $line.Trim().Split(' ')
  try {
    switch ($a[0]) {
      'wait' {
        # Attend l'ouverture de la fenetre (en dixiemes de seconde)
        $script:alpha = [int]$a[1]; $script:styled = [IntPtr]::Zero
        for ($i = 0; $i -lt [int]$a[2]; $i++) { if ((Ready) -ne [IntPtr]::Zero) { break }; Start-Sleep -Milliseconds 100 }
      }
      'alpha' {
        $script:alpha = [int]$a[1]
        $h = Ready; if ($h -ne [IntPtr]::Zero) { [TftHud]::SetLayeredWindowAttributes($h, 0, [byte]$script:alpha, 0x2) | Out-Null }
      }
      'size' {
        $h = Ready; if ($h -ne [IntPtr]::Zero) { [TftHud]::SetWindowPos($h, [IntPtr](-1), 0, 0, [int]$a[1], [int]$a[2], 0x0012) | Out-Null }
      }
      'region' {
        # region vx vy x1 y1 x2 y2 ... : contour du panneau, relatif au coin haut-gauche de la page (vx, vy sur l'ecran)
        $h = Ready
        if ($h -ne [IntPtr]::Zero) {
          if ($a.Length -lt 9) { [TftHud]::SetWindowRgn($h, [IntPtr]::Zero, $true) | Out-Null }
          else {
            $r = New-Object TftHud+RECT; [TftHud]::GetWindowRect($h, [ref]$r) | Out-Null
            $ox = [int]$a[1] - $r.L; $oy = [int]$a[2] - $r.T
            $n = [int](($a.Length - 3) / 2)
            $pts = New-Object 'TftHud+POINT[]' $n
            for ($i = 0; $i -lt $n; $i++) { $pts[$i] = [TftHud+POINT]::new(([int]$a[3 + 2 * $i] + $ox), ([int]$a[4 + 2 * $i] + $oy)) }
            $rgn = [TftHud]::CreatePolygonRgn($pts, $n, 1)
            [TftHud]::SetWindowRgn($h, $rgn, $true) | Out-Null
          }
        }
      }
      'movestart' {
        $h = Ready
        if ($h -ne [IntPtr]::Zero) { $r = New-Object TftHud+RECT; [TftHud]::GetWindowRect($h, [ref]$r) | Out-Null; $script:start = $r }
      }
      'moveby' {
        $h = Ready
        if ($h -ne [IntPtr]::Zero -and $null -ne $script:start) {
          [TftHud]::SetWindowPos($h, [IntPtr](-1), $script:start.L + [int]$a[1], $script:start.T + [int]$a[2], 0, 0, 0x0011) | Out-Null
        }
      }
      'close' {
        $h = Get-Hud; if ($h -ne [IntPtr]::Zero) { [TftHud]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }
        $script:h = [IntPtr]::Zero; $script:styled = [IntPtr]::Zero
      }
    }
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
