//! 앱 안 업데이트: 확인 → (사용자 승인) → 다운로드·sha256 검증 → 도우미 스크립트로 교체·재실행.
//!
//! 기존 sungback/cat_timer의 updater.js(확인만)와 selfupdate.js(교체 도우미)를 옮긴 것이다.
//! Tauri 업데이터 플러그인과 서명 키는 쓰지 않는다.
//!
//! 무결성 한계: 검증에 쓰는 .sha256 파일이 같은 릴리스에 올라가므로 다운로드 손상은 막지만,
//! 릴리스를 바꿀 수 있는 사람(GitHub 계정 탈취 등)은 막지 못한다.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

pub const REPO: &str = "sungback/cat_timer2";
// 에셋 파일명은 버전 없이 고정하고 태그가 버전을 구분한다. (build.yml과 같은 이름이어야 한다)
pub const MAC_ASSET: &str = "CatTimer2-macOS.zip";
pub const WIN_ASSET: &str = "CatTimer2-Windows-Portable.exe";
const CHECKSUM_SUFFIX: &str = ".sha256";

const API_TIMEOUT: Duration = Duration::from_secs(10);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
const USER_AGENT: &str = "CatTimer2-updater";

// 응답 크기 상한. 상한을 넘으면 받다가 중단한다(디스크·메모리를 채우는 비정상 릴리스 방어).
const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;
const MAX_CHECKSUM_BYTES: u64 = 4 * 1024;
const MAX_API_BYTES: u64 = 1024 * 1024;
const MAX_REDIRECTS: usize = 10;

// ---------------------------------------------------------------------------
// 릴리스 정보와 순수 함수 (네트워크·파일 없이 테스트할 수 있는 부분)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ReleaseAsset {
  pub name: String,
  #[serde(default)]
  pub browser_download_url: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Release {
  pub tag_name: String,
  #[serde(default)]
  pub html_url: String,
  #[serde(default)]
  pub assets: Vec<ReleaseAsset>,
}

/// 프론트로 넘기는 "새 버전 있음" 정보.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
  pub current: String,
  pub latest: String,
  pub tag: String,
  pub html_url: String,
}

/// "v1.2.3" 또는 "1.2.3"을 [1, 2, 3]으로. 숫자가 아닌 조각이 있으면 빈 벡터(= 비교 불가).
pub fn parse_version(tag: &str) -> Vec<u64> {
  let trimmed = tag.trim();
  let cleaned = trimmed
    .strip_prefix('v')
    .or_else(|| trimmed.strip_prefix('V'))
    .unwrap_or(trimmed);
  if cleaned.is_empty() {
    return Vec::new();
  }
  let mut parts = Vec::new();
  for piece in cleaned.split('.') {
    if piece.is_empty() || !piece.bytes().all(|b| b.is_ascii_digit()) {
      return Vec::new();
    }
    match piece.parse::<u64>() {
      Ok(n) => parts.push(n),
      Err(_) => return Vec::new(),
    }
  }
  parts
}

/// latest가 current보다 높은 버전인가. 어느 한쪽이라도 해석할 수 없으면 false.
pub fn is_newer(latest: &str, current: &str) -> bool {
  let a = parse_version(latest);
  let b = parse_version(current);
  if a.is_empty() || b.is_empty() {
    return false;
  }
  for i in 0..a.len().max(b.len()) {
    let x = a.get(i).copied().unwrap_or(0);
    let y = b.get(i).copied().unwrap_or(0);
    if x != y {
      return x > y;
    }
  }
  false
}

pub fn latest_api_url() -> String {
  format!("https://api.github.com/repos/{REPO}/releases/latest")
}

fn download_url_prefix() -> String {
  format!("https://github.com/{REPO}/releases/download/")
}

/// 다운로드는 이 저장소의 릴리스 에셋 주소만 허용한다.
pub fn is_allowed_download_url(url: &str) -> bool {
  url.starts_with(&download_url_prefix())
}

/// 브라우저로 열 수 있는 릴리스 페이지인지. 셸 특수문자가 섞인 주소는 거부한다(윈도우 `start` 대비).
pub fn is_release_page_url(url: &str) -> bool {
  let base = format!("https://github.com/{REPO}/releases");
  let prefix_ok = url == base || url.starts_with(&format!("{base}/"));
  prefix_ok
    && url
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || "/._-:~%".contains(c))
}

/// 리다이렉트를 따라가도 되는 주소인가: https이고 기본 포트이며 호스트가 GitHub 계열일 때만.
/// (GitHub 릴리스 다운로드는 `*.githubusercontent.com`으로 넘어간다)
pub fn is_allowed_redirect(url: &reqwest::Url) -> bool {
  if url.scheme() != "https" || url.port().is_some() {
    return false;
  }
  let Some(host) = url.host_str() else {
    return false;
  };
  let host = host.to_ascii_lowercase();
  host == "github.com" || host.ends_with(".github.com") || host.ends_with(".githubusercontent.com")
}

/// 크기 상한을 사람이 읽을 수 있게: 1MB 이상이면 MB, 아니면 KB.
pub fn format_limit(max: u64) -> String {
  if max >= 1024 * 1024 {
    format!("{}MB", max / (1024 * 1024))
  } else {
    format!("{}KB", max / 1024)
  }
}

fn too_large_message(max: u64) -> String {
  format!("받으려는 파일이 크기 상한({})을 넘어 중단했습니다.", format_limit(max))
}

pub fn parse_release(bytes: &[u8]) -> Option<Release> {
  let release: Release = serde_json::from_slice(bytes).ok()?;
  if release.tag_name.trim().is_empty() {
    None
  } else {
    Some(release)
  }
}

pub fn find_asset<'a>(release: &'a Release, name: &str) -> Option<&'a ReleaseAsset> {
  release
    .assets
    .iter()
    .find(|a| a.name == name && is_allowed_download_url(&a.browser_download_url))
}

/// 새 버전이고, 이 플랫폼의 에셋과 .sha256이 모두 올라와 있을 때만 업데이트로 본다.
/// (한쪽 플랫폼 빌드가 빠진 반쪽 릴리스를 업데이트로 안내하지 않기 위함)
pub fn pick_update(release: &Release, current: &str, asset: &str) -> Option<UpdateInfo> {
  if !is_newer(&release.tag_name, current) {
    return None;
  }
  find_asset(release, asset)?;
  find_asset(release, &format!("{asset}{CHECKSUM_SUFFIX}"))?;
  let tag = release.tag_name.trim();
  let latest = tag
    .strip_prefix('v')
    .or_else(|| tag.strip_prefix('V'))
    .unwrap_or(tag);
  Some(UpdateInfo {
    current: current.to_string(),
    latest: latest.to_string(),
    tag: tag.to_string(),
    html_url: release.html_url.clone(),
  })
}

/// ".sha256" 파일 내용에서 첫 토큰(해시)만 꺼낸다.
pub fn parse_checksum(text: &str) -> String {
  text.split_whitespace().next().unwrap_or("").to_string()
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
  let mut file = File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buf = [0u8; 65536];
  loop {
    let n = file.read(&mut buf)?;
    if n == 0 {
      break;
    }
    hasher.update(&buf[..n]);
  }
  Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// 기대 해시가 64자리 16진수가 아니면 무조건 false. 대소문자는 구분하지 않는다.
pub fn verify_sha256(path: &Path, expected: &str) -> bool {
  let expected = expected.trim().to_ascii_lowercase();
  if expected.len() != 64 || !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
    return false;
  }
  sha256_file(path).map(|got| got == expected).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// 도우미 스크립트 생성 (실행 중인 앱은 자신을 덮어쓸 수 없으므로 종료 후 교체한다)
// ---------------------------------------------------------------------------

/// bash 단일 따옴표 인용. 값 안의 `'`는 `'\''`로 바꾼다.
pub fn sh_quote(s: &str) -> String {
  format!("'{}'", s.replace('\'', "'\\''"))
}

/// macOS: .app 번들 단위 교체. 실패하면 원래 앱으로 되돌리고 다시 연다.
pub fn mac_update_script(
  pid: u32,
  current_app: &str,
  new_app: &str,
  log_path: &str,
  cleanup: &[&str],
) -> String {
  let mut lines: Vec<String> = vec![
    "#!/bin/bash".to_string(),
    format!("CT_PID={pid}"),
    format!("CT_CURRENT={}", sh_quote(current_app)),
    format!("CT_NEW={}", sh_quote(new_app)),
    format!("CT_LOG={}", sh_quote(log_path)),
    r#"echo "$(date) self-update start pid=$CT_PID" > "$CT_LOG""#.to_string(),
    "CT_TRIES=0".to_string(),
    r#"while kill -0 "$CT_PID" 2>/dev/null; do"#.to_string(),
    "  CT_TRIES=$((CT_TRIES + 1))".to_string(),
    r#"  if [ "$CT_TRIES" -ge 900 ]; then echo "$(date) wait cap reached, abort" >> "$CT_LOG"; rm -f "$0"; exit 1; fi"#.to_string(),
    "  sleep 0.2".to_string(),
    "done".to_string(),
    "sleep 0.5".to_string(),
    r#"echo "$(date) swap start" >> "$CT_LOG""#.to_string(),
    r#"CT_BAK="${CT_CURRENT}.bak""#.to_string(),
    r#"rm -rf "$CT_BAK""#.to_string(),
    r#"mv "$CT_CURRENT" "$CT_BAK" || { echo "move-aside failed" >> "$CT_LOG"; open "$CT_CURRENT"; exit 1; }"#.to_string(),
    r#"mv "$CT_NEW" "$CT_CURRENT" || { echo "move-in failed, restoring" >> "$CT_LOG"; mv "$CT_BAK" "$CT_CURRENT"; open "$CT_CURRENT"; exit 1; }"#.to_string(),
    r#"xattr -dr com.apple.quarantine "$CT_CURRENT" 2>/dev/null || true"#.to_string(),
    r#"open "$CT_CURRENT""#.to_string(),
    r#"rm -rf "$CT_BAK""#.to_string(),
  ];
  for path in cleanup {
    lines.push(format!("rm -rf {} 2>/dev/null", sh_quote(path)));
  }
  lines.push(r#"echo "$(date) done" >> "$CT_LOG""#.to_string());
  lines.push(r#"rm -f "$0""#.to_string());
  lines.join("\n") + "\n"
}

/// 배치 파일에서 `%`는 `%%`로 써야 한다.
// 윈도우에서만 실행되지만 스크립트 생성은 모든 OS에서 테스트하므로 다른 OS의 dead_code 경고만 끈다.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub fn bat_escape(s: &str) -> String {
  s.replace('%', "%%")
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
/// Windows: 포터블 단일 exe 교체. 이동이 실패하면(백신 등이 잡고 있을 때) 최대 10번 재시도하고,
/// 끝내 실패하면 기존 exe를 다시 실행한다.
pub fn windows_update_batch(
  pid: u32,
  image_name: &str,
  current_exe: &str,
  new_exe: &str,
  cleanup_dirs: &[&str],
) -> String {
  let mut lines: Vec<String> = vec![
    "@echo off".to_string(),
    "chcp 65001 >nul".to_string(),
    r#"cd /d "%TEMP%""#.to_string(),
    "setlocal".to_string(),
    format!(r#"set "CT_PID={pid}""#),
    format!(r#"set "CT_IMAGE={}""#, bat_escape(image_name)),
    format!(r#"set "CT_CURRENT={}""#, bat_escape(current_exe)),
    format!(r#"set "CT_NEW={}""#, bat_escape(new_exe)),
    r#"set "CT_TRIES=0""#.to_string(),
    ":waitloop".to_string(),
    r#"tasklist /FI "PID eq %CT_PID%" /FI "IMAGENAME eq %CT_IMAGE%" 2>nul | find "%CT_PID%" >nul 2>&1"#.to_string(),
    "if errorlevel 1 goto swap".to_string(),
    "set /a CT_TRIES+=1".to_string(),
    "if %CT_TRIES% GEQ 180 goto failed".to_string(),
    "ping -n 2 127.0.0.1 >nul".to_string(),
    "goto waitloop".to_string(),
    ":swap".to_string(),
    "ping -n 2 127.0.0.1 >nul".to_string(),
    r#"set "CT_TRIES=0""#.to_string(),
    ":moveloop".to_string(),
    r#"move /y "%CT_NEW%" "%CT_CURRENT%" >nul 2>&1"#.to_string(),
    r#"if not exist "%CT_NEW%" goto moved"#.to_string(),
    "set /a CT_TRIES+=1".to_string(),
    "if %CT_TRIES% GEQ 10 goto failed".to_string(),
    "ping -n 2 127.0.0.1 >nul".to_string(),
    "goto moveloop".to_string(),
    ":moved".to_string(),
    r#"start "" "%CT_CURRENT%""#.to_string(),
  ];
  for dir in cleanup_dirs {
    lines.push(format!(r#"rmdir /s /q "{}" 2>nul"#, bat_escape(dir)));
  }
  lines.push(r#"del "%~f0""#.to_string());
  lines.push("exit /b 0".to_string());
  lines.push(":failed".to_string());
  // 교체하지 못했으면 기존 앱을 다시 띄운다.
  lines.push(r#"start "" "%CT_CURRENT%""#.to_string());
  lines.push(r#"del "%~f0""#.to_string());
  lines.push("exit /b 1".to_string());
  lines.join("\r\n") + "\r\n"
}

// ---------------------------------------------------------------------------
// 파일·네트워크 (실제 업데이트 동작)
// ---------------------------------------------------------------------------

/// 이 플랫폼용 에셋 이름. 지원하지 않는 플랫폼(Intel 맥, 리눅스 등)은 None → 업데이트 확인을 건너뛴다.
pub fn platform_asset() -> Option<&'static str> {
  if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
    Some(MAC_ASSET)
  } else if cfg!(target_os = "windows") {
    Some(WIN_ASSET)
  } else {
    None
  }
}

fn http_client(timeout: Duration) -> Result<reqwest::Client, String> {
  http_client_with(timeout, is_allowed_redirect)
}

/// 리다이렉트 허용 규칙을 바꿀 수 있는 생성자(운영에서는 `is_allowed_redirect`, 테스트에서는 로컬 서버 허용).
fn http_client_with(timeout: Duration, allow: fn(&reqwest::Url) -> bool) -> Result<reqwest::Client, String> {
  let policy = reqwest::redirect::Policy::custom(move |attempt| {
    if attempt.previous().len() >= MAX_REDIRECTS {
      return attempt.error("리다이렉트가 너무 많습니다.");
    }
    if allow(attempt.url()) {
      attempt.follow()
    } else {
      let host = attempt.url().host_str().unwrap_or("?").to_string();
      attempt.error(format!("허용되지 않은 리다이렉트: {host}"))
    }
  });
  reqwest::Client::builder()
    .user_agent(USER_AGENT)
    .timeout(timeout)
    .redirect(policy)
    .build()
    .map_err(|e| format!("HTTP 클라이언트를 만들지 못했습니다: {e}"))
}

/// reqwest 오류는 최상위 문구만으로는 원인을 알기 어려워 원인 체인을 이어 붙인다.
fn describe_error(e: &dyn std::error::Error) -> String {
  let mut text = e.to_string();
  let mut source = e.source();
  while let Some(inner) = source {
    text.push_str(": ");
    text.push_str(&inner.to_string());
    source = inner.source();
  }
  text
}

/// 응답 본문을 최대 `max`바이트까지만 읽는다. 선언된 길이나 실제 받은 양이 넘으면 오류.
async fn read_limited(mut resp: reqwest::Response, max: u64) -> Result<Vec<u8>, String> {
  if resp.content_length().is_some_and(|n| n > max) {
    return Err(too_large_message(max));
  }
  let mut out: Vec<u8> = Vec::new();
  while let Some(chunk) = resp
    .chunk()
    .await
    .map_err(|e| format!("응답을 읽지 못했습니다: {}", describe_error(&e)))?
  {
    if out.len() as u64 + chunk.len() as u64 > max {
      return Err(too_large_message(max));
    }
    out.extend_from_slice(&chunk);
  }
  Ok(out)
}

/// 오프라인·rate limit·파싱 오류는 모두 None(조용히 건너뜀).
async fn fetch_latest(client: &reqwest::Client) -> Option<Release> {
  let resp = client
    .get(latest_api_url())
    .header("Accept", "application/vnd.github+json")
    .send()
    .await
    .ok()?;
  if !resp.status().is_success() {
    return None;
  }
  let bytes = read_limited(resp, MAX_API_BYTES).await.ok()?;
  parse_release(&bytes)
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|e| format!("체크섬을 받지 못했습니다: {}", describe_error(&e)))?;
  if !resp.status().is_success() {
    return Err(format!("체크섬 다운로드 실패 (HTTP {})", resp.status().as_u16()));
  }
  let bytes = read_limited(resp, MAX_CHECKSUM_BYTES).await?;
  String::from_utf8(bytes).map_err(|_| "체크섬 파일이 텍스트가 아닙니다.".to_string())
}

async fn download_to(
  client: &reqwest::Client,
  url: &str,
  dest: &Path,
  max_bytes: u64,
  // Tauri 비동기 명령의 future는 Send여야 하므로 콜백에도 Send를 요구한다.
  on_progress: &mut (dyn FnMut(u64, Option<u64>) + Send),
) -> Result<(), String> {
  let mut resp = client
    .get(url)
    .header("Accept", "application/octet-stream")
    .send()
    .await
    .map_err(|e| format!("다운로드에 실패했습니다: {}", describe_error(&e)))?;
  if !resp.status().is_success() {
    return Err(format!("다운로드 실패 (HTTP {})", resp.status().as_u16()));
  }
  let total = resp.content_length();
  // 길이를 미리 알려 주는 서버는 파일을 만들기 전에 거부한다.
  if total.is_some_and(|t| t > max_bytes) {
    return Err(too_large_message(max_bytes));
  }
  let mut file = File::create(dest).map_err(|e| format!("임시 파일을 만들지 못했습니다: {e}"))?;
  let mut received: u64 = 0;
  while let Some(chunk) = resp
    .chunk()
    .await
    .map_err(|e| format!("다운로드 중 오류: {}", describe_error(&e)))?
  {
    received += chunk.len() as u64;
    // 길이를 알리지 않거나 거짓으로 알리는 서버: 받는 도중에 상한을 넘으면 중단하고 부분 파일을 지운다.
    if received > max_bytes {
      drop(file);
      let _ = fs::remove_file(dest);
      return Err(too_large_message(max_bytes));
    }
    file
      .write_all(&chunk)
      .map_err(|e| format!("임시 파일에 쓰지 못했습니다: {e}"))?;
    on_progress(received, total);
  }
  file.flush().map_err(|e| format!("임시 파일 저장 실패: {e}"))?;
  Ok(())
}

fn staging_dir() -> Result<PathBuf, String> {
  let nanos = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);
  let dir = std::env::temp_dir().join(format!("CatTimer2-update-{}-{nanos}", std::process::id()));
  fs::create_dir_all(&dir).map_err(|e| format!("임시 폴더를 만들지 못했습니다: {e}"))?;
  Ok(dir)
}

/// 폴더에 파일을 만들 수 있는지(= 앱을 교체할 수 있는지) 실제로 시도해 본다.
fn dir_is_writable(dir: &Path) -> bool {
  let probe = dir.join(format!(".cattimer2-write-test-{}", std::process::id()));
  match File::create(&probe) {
    Ok(_) => {
      let _ = fs::remove_file(&probe);
      true
    }
    Err(_) => false,
  }
}

/// 교체 대상: macOS는 실행 중인 .app 번들, Windows는 실행 파일.
fn current_target() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|e| format!("실행 파일 위치를 알 수 없습니다: {e}"))?;
  if cfg!(target_os = "macos") {
    // .../CatTimer2.app/Contents/MacOS/cat-timer2 → .app
    match exe.ancestors().nth(3) {
      Some(app) if app.extension().is_some_and(|e| e == "app") && app.exists() => Ok(app.to_path_buf()),
      _ => Err("앱 번들(.app)로 실행 중이 아니라서 자동 업데이트를 할 수 없습니다.".to_string()),
    }
  } else {
    Ok(exe)
  }
}

/// 폴더 안에서 가장 얕은 위치의 .app 번들을 찾는다.
fn find_app_bundle(root: &Path) -> Option<PathBuf> {
  let mut level = vec![root.to_path_buf()];
  while !level.is_empty() {
    let mut next = Vec::new();
    for dir in &level {
      let Ok(entries) = fs::read_dir(dir) else { continue };
      let mut found: Vec<PathBuf> = Vec::new();
      for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
          if path.extension().is_some_and(|e| e == "app") {
            found.push(path);
          } else {
            next.push(path);
          }
        }
      }
      found.sort();
      if let Some(first) = found.into_iter().next() {
        return Some(first);
      }
    }
    level = next;
  }
  None
}

/// 내려받은 파일에서 "교체할 새 대상"을 만든다. macOS는 zip을 풀어 .app을, Windows는 exe 그대로.
fn prepare_new_target(staging: &Path, downloaded: &Path) -> Result<PathBuf, String> {
  if cfg!(target_os = "macos") {
    let out = staging.join("extracted");
    fs::create_dir_all(&out).map_err(|e| format!("압축 해제 폴더를 만들지 못했습니다: {e}"))?;
    // 심링크를 보존해야 코드 서명이 깨지지 않으므로 ditto를 쓴다.
    let status = Command::new("/usr/bin/ditto")
      .args(["-x", "-k"])
      .arg(downloaded)
      .arg(&out)
      .status()
      .map_err(|e| format!("압축을 풀지 못했습니다: {e}"))?;
    if !status.success() {
      return Err("압축 해제에 실패했습니다.".to_string());
    }
    find_app_bundle(&out).ok_or_else(|| "업데이트 압축본에 .app이 없습니다.".to_string())
  } else {
    Ok(downloaded.to_path_buf())
  }
}

#[cfg(target_os = "macos")]
fn spawn_helper(staging: &Path, current: &Path, new_target: &Path) -> Result<(), String> {
  use std::os::unix::fs::PermissionsExt;
  use std::os::unix::process::CommandExt;

  let script_path = staging.join("update.sh");
  let log_path = staging.join("update.sh.log");
  let script = mac_update_script(
    std::process::id(),
    &current.to_string_lossy(),
    &new_target.to_string_lossy(),
    &log_path.to_string_lossy(),
    &[&staging.to_string_lossy()],
  );
  fs::write(&script_path, script).map_err(|e| format!("도우미 스크립트를 쓰지 못했습니다: {e}"))?;
  fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755))
    .map_err(|e| format!("도우미 스크립트 권한 설정 실패: {e}"))?;
  // 앱이 종료돼도 살아남도록 새 프로세스 그룹에서 실행한다.
  Command::new("/bin/bash")
    .arg(&script_path)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .process_group(0)
    .spawn()
    .map_err(|e| format!("도우미를 실행하지 못했습니다: {e}"))?;
  Ok(())
}

#[cfg(target_os = "windows")]
fn spawn_helper(staging: &Path, current: &Path, new_target: &Path) -> Result<(), String> {
  use std::os::windows::process::CommandExt;

  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  const DETACHED_PROCESS: u32 = 0x0000_0008;

  let image = current
    .file_name()
    .map(|n| n.to_string_lossy().to_string())
    .ok_or_else(|| "실행 파일 이름을 알 수 없습니다.".to_string())?;
  // 배치 파일은 staging 밖에 둬서, staging 폴더 정리 중에도 스스로를 지울 수 있게 한다.
  let batch_path = std::env::temp_dir().join(format!("CatTimer2-update-{}.bat", std::process::id()));
  let batch = windows_update_batch(
    std::process::id(),
    &image,
    &current.to_string_lossy(),
    &new_target.to_string_lossy(),
    &[&staging.to_string_lossy()],
  );
  fs::write(&batch_path, batch).map_err(|e| format!("도우미 배치 파일을 쓰지 못했습니다: {e}"))?;
  Command::new("cmd")
    .arg("/c")
    .arg(&batch_path)
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
    .spawn()
    .map_err(|e| format!("도우미를 실행하지 못했습니다: {e}"))?;
  Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn spawn_helper(_staging: &Path, _current: &Path, _new_target: &Path) -> Result<(), String> {
  Err("이 운영체제는 자동 업데이트를 지원하지 않습니다.".to_string())
}

fn open_url(url: &str) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  let result = Command::new("open").arg(url).spawn();
  #[cfg(target_os = "windows")]
  let result = Command::new("cmd").args(["/c", "start", "", url]).spawn();
  #[cfg(not(any(target_os = "macos", target_os = "windows")))]
  let result: std::io::Result<std::process::Child> = Err(std::io::Error::other("unsupported"));
  result.map(|_| ()).map_err(|e| format!("브라우저를 열지 못했습니다: {e}"))
}

// ---------------------------------------------------------------------------
// Tauri 명령 (프론트에서 invoke로 호출)
// ---------------------------------------------------------------------------

#[derive(Clone, Serialize)]
struct Progress {
  received: u64,
  total: Option<u64>,
  percent: Option<u8>,
}

/// 새 버전이 있으면 정보를, 없거나 확인할 수 없으면 None을 돌려준다(오류도 조용히 None).
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Option<UpdateInfo> {
  let asset = platform_asset()?;
  let current = app.package_info().version.to_string();
  let client = http_client(API_TIMEOUT).ok()?;
  let release = fetch_latest(&client).await?;
  pick_update(&release, &current, asset)
}

/// 사용자가 승인한 뒤 호출한다. 다운로드 → sha256 검증 → 도우미 실행 → 앱 종료.
/// 실패하면 아무것도 교체하지 않고 임시 파일을 지운 뒤 오류 문구를 돌려준다.
#[tauri::command]
pub async fn apply_update(app: AppHandle) -> Result<(), String> {
  let asset = platform_asset().ok_or("이 운영체제는 자동 업데이트를 지원하지 않습니다.")?;
  let current_version = app.package_info().version.to_string();
  let client = http_client(DOWNLOAD_TIMEOUT)?;
  // 프론트가 넘긴 값을 믿지 않고 다시 조회해서 판단한다.
  let release = fetch_latest(&client)
    .await
    .ok_or("최신 버전 정보를 가져오지 못했습니다.")?;
  if pick_update(&release, &current_version, asset).is_none() {
    return Err("적용할 새 버전이 없습니다.".to_string());
  }
  let asset_entry = find_asset(&release, asset).ok_or("업데이트 파일을 찾지 못했습니다.")?;
  let sum_entry = find_asset(&release, &format!("{asset}{CHECKSUM_SUFFIX}"))
    .ok_or("체크섬 파일을 찾지 못했습니다.")?;

  let current = current_target()?;
  let parent = current.parent().ok_or("앱 위치를 알 수 없습니다.")?;
  if !dir_is_writable(parent) {
    return Err(format!(
      "앱이 있는 폴더({})에 쓸 수 없어 자동 업데이트를 할 수 없습니다. 릴리스 페이지에서 직접 받아 주세요.",
      parent.display()
    ));
  }

  let staging = staging_dir()?;
  let result = run_update(
    &app,
    &client,
    &asset_entry.browser_download_url,
    &sum_entry.browser_download_url,
    &staging,
    &current,
    asset,
  )
  .await;
  match result {
    Ok(()) => {
      app.exit(0);
      Ok(())
    }
    Err(e) => {
      let _ = fs::remove_dir_all(&staging);
      Err(e)
    }
  }
}

async fn run_update(
  app: &AppHandle,
  client: &reqwest::Client,
  asset_url: &str,
  sum_url: &str,
  staging: &Path,
  current: &Path,
  asset_name: &str,
) -> Result<(), String> {
  let downloaded = staging.join(asset_name);
  let mut last_percent: Option<u8> = None;
  let mut on_progress = |received: u64, total: Option<u64>| {
    let percent = total
      .filter(|t| *t > 0)
      .map(|t| ((received.saturating_mul(100)) / t).min(100) as u8);
    if percent != last_percent {
      last_percent = percent;
      let _ = app.emit("update-progress", Progress { received, total, percent });
    }
  };
  download_to(client, asset_url, &downloaded, MAX_DOWNLOAD_BYTES, &mut on_progress).await?;

  let expected = parse_checksum(&fetch_text(client, sum_url).await?);
  if !verify_sha256(&downloaded, &expected) {
    return Err("다운로드한 파일의 체크섬이 일치하지 않아 업데이트를 중단했습니다.".to_string());
  }

  let new_target = prepare_new_target(staging, &downloaded)?;
  spawn_helper(staging, current, &new_target)
}

/// 업데이트가 안 될 때의 대체 수단: 이 저장소의 릴리스 페이지만 브라우저로 연다.
#[tauri::command]
pub fn open_release_page(url: String) -> Result<(), String> {
  if !is_release_page_url(&url) {
    return Err("허용되지 않은 주소입니다.".to_string());
  }
  open_url(&url)
}

#[cfg(test)]
mod tests;
