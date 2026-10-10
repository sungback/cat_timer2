use super::*;

fn temp_case_dir(name: &str) -> PathBuf {
  let nanos = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap()
    .as_nanos();
  let dir = std::env::temp_dir().join(format!("ct2-test-{name}-{}-{nanos}", std::process::id()));
  fs::create_dir_all(&dir).unwrap();
  dir
}

/// 에셋 주소 규칙(build.yml이 만드는 파일명)과 같은 모양의 주소.
fn asset_url(tag: &str, asset: &str) -> String {
  format!("{}{tag}/{asset}", download_url_prefix())
}

fn release_json(extra_assets: &str) -> String {
  let base = "https://github.com/sungback/cat_timer2/releases/download/v0.2.0";
  format!(
    r#"{{
      "tag_name": "v0.2.0",
      "html_url": "https://github.com/sungback/cat_timer2/releases/tag/v0.2.0",
      "assets": [
        {{"name": "CatTimer2-macOS.zip", "browser_download_url": "{base}/CatTimer2-macOS.zip"}},
        {{"name": "CatTimer2-macOS.zip.sha256", "browser_download_url": "{base}/CatTimer2-macOS.zip.sha256"}},
        {{"name": "CatTimer2-Windows-Portable.exe", "browser_download_url": "{base}/CatTimer2-Windows-Portable.exe"}},
        {{"name": "CatTimer2-Windows-Portable.exe.sha256", "browser_download_url": "{base}/CatTimer2-Windows-Portable.exe.sha256"}}
        {extra_assets}
      ]
    }}"#
  )
}

// --- 버전 ---------------------------------------------------------------

#[test]
fn parse_version_accepts_v_prefix_and_rejects_non_numeric() {
  assert_eq!(parse_version("v1.2.3"), vec![1, 2, 3]);
  assert_eq!(parse_version("V0.10"), vec![0, 10]);
  assert_eq!(parse_version(" 2.0.1 "), vec![2, 0, 1]);
  for bad in ["", "v", "1.x", "1..2", "1.2-beta", "+1.2", "-1", "latest", "1.2.3.", "vv1"] {
    assert!(parse_version(bad).is_empty(), "{bad:?}는 해석할 수 없어야 한다");
  }
  // u64를 넘는 숫자도 패닉 없이 거부한다.
  assert!(parse_version("99999999999999999999999.1").is_empty());
}

#[test]
fn is_newer_compares_numerically_not_lexically() {
  assert!(is_newer("v0.1.1", "0.1.0"));
  assert!(is_newer("v0.10.0", "0.9.9"), "10은 9보다 크다");
  assert!(is_newer("1.0", "0.9.9"));
  assert!(is_newer("1.0.1", "1.0"), "없는 조각은 0으로 본다");
  assert!(!is_newer("1.0.0", "1.0"), "같은 버전");
  assert!(!is_newer("v0.1.0", "0.1.0"));
  assert!(!is_newer("0.1.0", "0.1.1"), "더 낮은 버전");
  // 해석할 수 없으면 업데이트로 보지 않는다.
  assert!(!is_newer("nightly", "0.1.0"));
  assert!(!is_newer("0.2.0", "dev"));
  assert!(!is_newer("", ""));
}

// --- 주소 ---------------------------------------------------------------

#[test]
fn urls_follow_the_fixed_asset_rule() {
  assert_eq!(
    asset_url("v0.2.0", MAC_ASSET),
    "https://github.com/sungback/cat_timer2/releases/download/v0.2.0/CatTimer2-macOS.zip"
  );
  assert_eq!(
    latest_api_url(),
    "https://api.github.com/repos/sungback/cat_timer2/releases/latest"
  );
}

#[test]
fn only_this_repos_release_downloads_are_allowed() {
  assert!(is_allowed_download_url(&asset_url("v1.0.0", WIN_ASSET)));
  for bad in [
    "https://github.com/evil/cat_timer2/releases/download/v1/x.zip",
    "http://github.com/sungback/cat_timer2/releases/download/v1/x.zip",
    "https://github.com.evil.com/sungback/cat_timer2/releases/download/v1/x.zip",
    "https://example.com/sungback/cat_timer2/releases/download/v1/x.zip",
    "",
  ] {
    assert!(!is_allowed_download_url(bad), "{bad:?}는 거부해야 한다");
  }
}

#[test]
fn release_page_url_rejects_shell_metacharacters() {
  assert!(is_release_page_url("https://github.com/sungback/cat_timer2/releases"));
  assert!(is_release_page_url("https://github.com/sungback/cat_timer2/releases/tag/v0.2.0"));
  for bad in [
    "https://github.com/sungback/cat_timer2/releasesX",
    "https://github.com/sungback/cat_timer2/releases/tag/v1&calc.exe",
    "https://github.com/sungback/cat_timer2/releases/tag/v1 calc",
    "https://github.com/sungback/cat_timer2/releases/tag/v1|dir",
    "https://github.com/sungback/cat_timer2/releases/tag/\"v1",
    "https://github.com/sungback/other/releases",
    "javascript:alert(1)",
    "",
  ] {
    assert!(!is_release_page_url(bad), "{bad:?}는 거부해야 한다");
  }
}

// --- 릴리스 JSON → 업데이트 판단 ----------------------------------------

#[test]
fn pick_update_requires_newer_version_and_both_assets() {
  let release = parse_release(release_json("").as_bytes()).expect("정상 JSON");
  let info = pick_update(&release, "0.1.0", MAC_ASSET).expect("새 버전");
  assert_eq!(
    info,
    UpdateInfo {
      current: "0.1.0".into(),
      latest: "0.2.0".into(),
      tag: "v0.2.0".into(),
      html_url: "https://github.com/sungback/cat_timer2/releases/tag/v0.2.0".into(),
    }
  );
  assert!(pick_update(&release, "0.2.0", MAC_ASSET).is_none(), "같은 버전");
  assert!(pick_update(&release, "0.3.0", MAC_ASSET).is_none(), "더 높은 버전을 쓰는 중");
  assert!(pick_update(&release, "0.1.0", WIN_ASSET).is_some());
}

#[test]
fn pick_update_ignores_half_published_releases() {
  // .sha256이 없는 릴리스
  let no_sum = r#"{"tag_name":"v0.2.0","html_url":"","assets":[
    {"name":"CatTimer2-macOS.zip","browser_download_url":"https://github.com/sungback/cat_timer2/releases/download/v0.2.0/CatTimer2-macOS.zip"}]}"#;
  let release = parse_release(no_sum.as_bytes()).unwrap();
  assert!(pick_update(&release, "0.1.0", MAC_ASSET).is_none());

  // 에셋이 아예 없는 릴리스
  let empty = parse_release(br#"{"tag_name":"v0.2.0"}"#).unwrap();
  assert!(pick_update(&empty, "0.1.0", MAC_ASSET).is_none());

  // 다른 곳을 가리키는 다운로드 주소
  let foreign = r#"{"tag_name":"v0.2.0","assets":[
    {"name":"CatTimer2-macOS.zip","browser_download_url":"https://evil.example/CatTimer2-macOS.zip"},
    {"name":"CatTimer2-macOS.zip.sha256","browser_download_url":"https://github.com/sungback/cat_timer2/releases/download/v0.2.0/CatTimer2-macOS.zip.sha256"}]}"#;
  let release = parse_release(foreign.as_bytes()).unwrap();
  assert!(pick_update(&release, "0.1.0", MAC_ASSET).is_none());
}

#[test]
fn parse_release_rejects_garbage() {
  assert!(parse_release(b"not json").is_none());
  assert!(parse_release(b"{}").is_none());
  assert!(parse_release(br#"{"tag_name":"  "}"#).is_none());
  assert!(parse_release(br#"{"message":"API rate limit exceeded"}"#).is_none());
}

// --- 체크섬 -------------------------------------------------------------

const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

#[test]
fn parse_checksum_takes_first_token() {
  assert_eq!(parse_checksum(ABC_SHA256), ABC_SHA256);
  assert_eq!(parse_checksum(&format!("{ABC_SHA256}\n")), ABC_SHA256);
  assert_eq!(parse_checksum(&format!("{ABC_SHA256}  CatTimer2-macOS.zip\n")), ABC_SHA256);
  assert_eq!(parse_checksum("  \n"), "");
}

#[test]
fn verify_sha256_matches_known_vector_and_rejects_bad_input() {
  let dir = temp_case_dir("sha");
  let file = dir.join("abc.bin");
  fs::write(&file, b"abc").unwrap();

  assert_eq!(sha256_file(&file).unwrap(), ABC_SHA256);
  assert!(verify_sha256(&file, ABC_SHA256));
  assert!(verify_sha256(&file, &ABC_SHA256.to_uppercase()), "대소문자 무시");
  assert!(verify_sha256(&file, &format!("  {ABC_SHA256}\n")), "앞뒤 공백 무시");

  let wrong = "0".repeat(64);
  assert!(!verify_sha256(&file, &wrong), "다른 해시");
  assert!(!verify_sha256(&file, ""), "빈 해시는 통과시키지 않는다");
  assert!(!verify_sha256(&file, "abc"), "짧은 해시");
  assert!(!verify_sha256(&file, &"g".repeat(64)), "16진수가 아닌 문자");
  assert!(!verify_sha256(&dir.join("missing.bin"), ABC_SHA256), "파일이 없으면 실패");

  // 한 바이트만 달라도 실패해야 한다.
  fs::write(&file, b"abd").unwrap();
  assert!(!verify_sha256(&file, ABC_SHA256));

  fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sha256_file_handles_files_larger_than_the_read_buffer() {
  let dir = temp_case_dir("sha-big");
  let file = dir.join("big.bin");
  // 65536(읽기 버퍼)보다 크고 버퍼 크기의 배수가 아닌 크기
  fs::write(&file, vec![0x61u8; 200_000]).unwrap();
  let expected = {
    let mut h = Sha256::new();
    h.update(vec![0x61u8; 200_000]);
    h.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>()
  };
  assert_eq!(sha256_file(&file).unwrap(), expected);
  fs::remove_dir_all(&dir).unwrap();
}

// --- 도우미 스크립트 ----------------------------------------------------

#[test]
fn sh_quote_escapes_single_quotes() {
  assert_eq!(sh_quote("plain"), "'plain'");
  assert_eq!(sh_quote("it's"), r"'it'\''s'");
  assert_eq!(sh_quote("a b"), "'a b'");
}

#[test]
fn bat_escape_doubles_percent() {
  assert_eq!(bat_escape("C:\\100%\\a.exe"), "C:\\100%%\\a.exe");
}

#[test]
fn mac_script_has_expected_structure() {
  let script = mac_update_script(4242, "/Applications/Cat Timer's.app", "/tmp/new/CatTimer2.app", "/tmp/u.log", &["/tmp/stage dir"]);
  assert!(script.starts_with("#!/bin/bash\n"));
  assert!(script.contains("CT_PID=4242\n"));
  assert!(script.contains(r"CT_CURRENT='/Applications/Cat Timer'\''s.app'"));
  assert!(script.contains("xattr -dr com.apple.quarantine"));
  assert!(script.contains("rm -rf '/tmp/stage dir'"));
  assert!(script.ends_with("rm -f \"$0\"\n"));
  // 종료를 기다린 뒤(kill -0)에 교체(mv)해야 한다.
  assert!(script.find("kill -0").unwrap() < script.find(r#"mv "$CT_CURRENT""#).unwrap());
}

#[cfg(unix)]
#[test]
fn mac_script_passes_bash_syntax_check() {
  let dir = temp_case_dir("syntax");
  let path = dir.join("u.sh");
  fs::write(
    &path,
    mac_update_script(1, "/a b/it's.app", "/c/d.app", "/e/f.log", &["/g h", "/i'j"]),
  )
  .unwrap();
  let status = Command::new("/bin/bash").arg("-n").arg(&path).status().unwrap();
  assert!(status.success(), "bash -n 문법 검사 실패");
  fs::remove_dir_all(&dir).unwrap();
}

/// 가짜 `open`을 PATH 앞에 두고 도우미를 실제로 실행한다. (이미 종료된 프로세스의 PID를 넘긴다)
#[cfg(target_os = "macos")]
fn run_helper_with_fake_open(base: &Path, current: &Path, new_app: &Path, staging: &Path) -> (std::process::ExitStatus, String) {
  use std::os::unix::fs::PermissionsExt;

  let shim_dir = base.join("shim");
  fs::create_dir_all(&shim_dir).unwrap();
  let open_log = base.join("open.log");
  let shim = shim_dir.join("open");
  fs::write(&shim, format!("#!/bin/bash\necho \"$@\" >> {}\n", sh_quote(&open_log.to_string_lossy()))).unwrap();
  fs::set_permissions(&shim, fs::Permissions::from_mode(0o755)).unwrap();

  let mut child = Command::new("/usr/bin/true").spawn().unwrap();
  let dead_pid = child.id();
  child.wait().unwrap();

  let script = mac_update_script(
    dead_pid,
    &current.to_string_lossy(),
    &new_app.to_string_lossy(),
    &base.join("update.log").to_string_lossy(),
    &[&staging.to_string_lossy()],
  );
  let script_path = base.join("update.sh");
  fs::write(&script_path, script).unwrap();
  let status = Command::new("/bin/bash")
    .arg(&script_path)
    .env("PATH", format!("{}:/usr/bin:/bin", shim_dir.display()))
    .status()
    .unwrap();
  assert!(!script_path.exists() || !status.success(), "성공하면 스크립트가 스스로 지워져야 한다");
  (status, fs::read_to_string(&open_log).unwrap_or_default())
}

#[cfg(target_os = "macos")]
#[test]
fn mac_helper_swaps_the_app_and_relaunches() {
  let base = temp_case_dir("swap");
  // 공백과 작은따옴표가 들어간 경로로 인용이 안전한지도 함께 본다.
  let current = base.join("Cat Timer's.app");
  fs::create_dir_all(current.join("Contents")).unwrap();
  fs::write(current.join("Contents/marker"), "old").unwrap();
  let new_app = base.join("new").join("CatTimer2.app");
  fs::create_dir_all(new_app.join("Contents")).unwrap();
  fs::write(new_app.join("Contents/marker"), "new").unwrap();
  let staging = base.join("staging dir");
  fs::create_dir_all(&staging).unwrap();
  fs::write(staging.join("leftover.zip"), "x").unwrap();

  let (status, open_log) = run_helper_with_fake_open(&base, &current, &new_app, &staging);

  assert!(status.success());
  assert_eq!(fs::read_to_string(current.join("Contents/marker")).unwrap(), "new", "새 앱으로 교체");
  assert!(!new_app.exists(), "새 앱은 제자리로 옮겨졌다");
  assert!(!PathBuf::from(format!("{}.bak", current.display())).exists(), "백업이 정리됐다");
  assert!(!staging.exists(), "임시 폴더가 정리됐다");
  assert!(open_log.contains("Cat Timer's.app"), "교체 후 앱을 다시 열었다: {open_log:?}");

  fs::remove_dir_all(&base).unwrap();
}

#[cfg(target_os = "macos")]
#[test]
fn mac_helper_restores_the_old_app_when_the_swap_fails() {
  let base = temp_case_dir("restore");
  let current = base.join("CatTimer2.app");
  fs::create_dir_all(current.join("Contents")).unwrap();
  fs::write(current.join("Contents/marker"), "old").unwrap();
  let missing_new = base.join("new").join("CatTimer2.app"); // 만들지 않는다 → 교체 실패
  let staging = base.join("staging");
  fs::create_dir_all(&staging).unwrap();

  let (status, open_log) = run_helper_with_fake_open(&base, &current, &missing_new, &staging);

  assert!(!status.success(), "교체 실패는 실패 상태로 끝나야 한다");
  assert_eq!(fs::read_to_string(current.join("Contents/marker")).unwrap(), "old", "기존 앱이 그대로 복구됨");
  assert!(!PathBuf::from(format!("{}.bak", current.display())).exists(), "백업이 남지 않는다");
  assert!(open_log.contains("CatTimer2.app"), "복구한 기존 앱을 다시 열었다: {open_log:?}");

  fs::remove_dir_all(&base).unwrap();
}

#[test]
fn windows_batch_retries_move_and_falls_back_to_old_app() {
  let bat = windows_update_batch(
    r"C:\Apps\100%\CatTimer2.exe",
    r"C:\Temp\stage\CatTimer2-Windows-Portable.exe",
    &[r"C:\Temp\stage"],
  );
  assert!(bat.contains("\r\n") && !bat.contains("\r\r"), "CRLF 줄바꿈");
  assert!(bat.ends_with("\r\n"));
  assert!(bat.contains(r#"set "CT_CURRENT=C:\Apps\100%%\CatTimer2.exe""#), "% 이스케이프");
  assert!(bat.contains(r#"rmdir /s /q "C:\Temp\stage""#));
  // 이동 재시도(moveloop) → 성공(moved) 순서, 실패 시 failed에서 기존 앱 재실행
  let moveloop = bat.find(":moveloop").unwrap();
  let moved = bat.find(":moved").unwrap();
  let failed = bat.find(":failed").unwrap();
  assert!(moveloop < moved && moved < failed);
  assert!(bat[failed..].contains(r#"start "" "%CT_CURRENT%""#), "실패해도 기존 앱을 다시 띄운다");
  assert!(bat.contains("if %CT_TRIES% GEQ 60 goto failed"), "이동 재시도 횟수 제한");
}

/// 회귀: 사용자 PATH에 유닉스 find가 있으면 `tasklist | find "PID"`가 오류를 냈다.
/// 배치는 PATH로 찾는 외부 명령(find, tasklist)을 쓰지 않고, 외부 명령은 System32 전체 경로로 부른다.
#[test]
fn windows_batch_does_not_depend_on_path_commands() {
  let bat = windows_update_batch(r"C:\Apps\CatTimer2.exe", r"C:\Temp\new.exe", &[]);
  let lines: Vec<&str> = bat.split("\r\n").collect();
  for forbidden in ["find", "tasklist", "findstr"] {
    assert!(
      !lines.iter().any(|l| l.split_whitespace().any(|w| w == forbidden)),
      "{forbidden}를 쓰면 안 된다"
    );
  }
  for external in ["chcp", "ping"] {
    for line in lines.iter().filter(|l| l.contains(external)) {
      assert!(line.contains(r"%SystemRoot%\System32\"), "전체 경로가 필요: {line}");
    }
  }
}

// --- 폴더 탐색 ----------------------------------------------------------

#[test]
fn find_app_bundle_prefers_the_shallowest_app() {
  let dir = temp_case_dir("find");
  fs::create_dir_all(dir.join("a/b/Deep.app/Contents")).unwrap();
  fs::create_dir_all(dir.join("Top.app/Contents")).unwrap();
  assert_eq!(find_app_bundle(&dir), Some(dir.join("Top.app")));

  let only_deep = temp_case_dir("find-deep");
  fs::create_dir_all(only_deep.join("x/y/Deep.app")).unwrap();
  assert_eq!(find_app_bundle(&only_deep), Some(only_deep.join("x/y/Deep.app")));

  let none = temp_case_dir("find-none");
  fs::create_dir_all(none.join("x/y")).unwrap();
  assert_eq!(find_app_bundle(&none), None);

  for d in [dir, only_deep, none] {
    fs::remove_dir_all(d).unwrap();
  }
}

#[test]
fn dir_is_writable_detects_missing_and_ok_dirs() {
  let dir = temp_case_dir("writable");
  assert!(dir_is_writable(&dir));
  assert!(!dir_is_writable(&dir.join("does-not-exist")));
  fs::remove_dir_all(&dir).unwrap();
}

// --- 네트워크 경로 (로컬 HTTP 서버로 download_to·fetch_text를 실제로 실행) ----------

/// /file(200, 본문), /redirect(302→/file), /sum(200, 텍스트)을 돌려주고 나머지는 404인 임시 서버.
fn start_test_server(body: Vec<u8>) -> u16 {
  use std::net::TcpListener;

  let listener = TcpListener::bind("127.0.0.1:0").unwrap();
  let port = listener.local_addr().unwrap().port();
  std::thread::spawn(move || {
    for stream in listener.incoming() {
      let Ok(mut stream) = stream else { break };
      let mut buf = [0u8; 4096];
      let n = stream.read(&mut buf).unwrap_or(0);
      let request = String::from_utf8_lossy(&buf[..n]).to_string();
      let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
      let (head, payload): (String, Vec<u8>) = match path.as_str() {
        "/file" => (
          format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()),
          body.clone(),
        ),
        "/redirect" => (
          "HTTP/1.1 302 Found\r\nLocation: /file\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
          Vec::new(),
        ),
        "/sum" => {
          let text = b"deadbeef  CatTimer2-macOS.zip\n".to_vec();
          (
            format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", text.len()),
            text,
          )
        }
        // Content-Length 없이 본문을 보내고 연결을 닫는다(길이를 속이거나 모르는 서버).
        "/stream" => ("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_string(), body.clone()),
        // 체크섬 파일 상한(4KB)을 넘는 본문
        "/bigsum" => (
          "HTTP/1.1 200 OK\r\nContent-Length: 5000\r\nConnection: close\r\n\r\n".to_string(),
          vec![b'a'; 5000],
        ),
        _ => (
          "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
          Vec::new(),
        ),
      };
      let _ = stream.write_all(head.as_bytes());
      let _ = stream.write_all(&payload);
    }
  });
  port
}

#[test]
fn download_to_saves_the_file_reports_progress_and_follows_redirects() {
  let body: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
  let port = start_test_server(body.clone());
  let dir = temp_case_dir("download");
  // 운영 정책은 http 리다이렉트를 막으므로, 이 테스트는 로컬 서버만 허용하는 클라이언트를 쓴다.
  let client = http_client_with(Duration::from_secs(10), |u| u.host_str() == Some("127.0.0.1")).unwrap();

  for route in ["file", "redirect"] {
    let dest = dir.join(format!("{route}.bin"));
    let mut calls: Vec<(u64, Option<u64>)> = Vec::new();
    let mut on_progress = |received: u64, total: Option<u64>| calls.push((received, total));
    tauri::async_runtime::block_on(download_to(
      &client,
      &format!("http://127.0.0.1:{port}/{route}"),
      &dest,
      MAX_DOWNLOAD_BYTES,
      &mut on_progress,
    ))
    .unwrap_or_else(|e| panic!("{route} 다운로드 실패: {e}"));

    assert_eq!(fs::read(&dest).unwrap(), body, "{route}: 받은 파일이 원본과 같아야 한다");
    assert!(!calls.is_empty(), "{route}: 진행률 콜백이 호출돼야 한다");
    assert!(calls.windows(2).all(|w| w[0].0 <= w[1].0), "{route}: 받은 바이트는 줄어들지 않는다");
    assert_eq!(calls.last().copied(), Some((300_000, Some(300_000))), "{route}: 마지막 진행률");

    // 체크섬 연계: 내려받은 파일의 실제 해시와는 일치하고, 다른 값과는 불일치해야 한다.
    let actual = sha256_file(&dest).unwrap();
    assert!(verify_sha256(&dest, &actual));
    assert!(!verify_sha256(&dest, &"0".repeat(64)));
  }

  fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn download_to_and_fetch_text_report_http_errors() {
  let port = start_test_server(vec![1, 2, 3]);
  let dir = temp_case_dir("download-err");
  let client = http_client(Duration::from_secs(10)).unwrap();

  let dest = dir.join("missing.bin");
  let err = tauri::async_runtime::block_on(download_to(
    &client,
    &format!("http://127.0.0.1:{port}/missing"),
    &dest,
    MAX_DOWNLOAD_BYTES,
    &mut |_, _| {},
  ))
  .unwrap_err();
  assert!(err.contains("404"), "HTTP 오류 번호가 문구에 있어야 한다: {err}");
  assert!(!dest.exists(), "실패한 다운로드는 파일을 남기지 않는다");

  let err = tauri::async_runtime::block_on(fetch_text(&client, &format!("http://127.0.0.1:{port}/missing")))
    .unwrap_err();
  assert!(err.contains("404"), "{err}");

  let text = tauri::async_runtime::block_on(fetch_text(&client, &format!("http://127.0.0.1:{port}/sum"))).unwrap();
  assert_eq!(parse_checksum(&text), "deadbeef");

  // 서버가 없는 포트: 연결 실패도 패닉 없이 오류 문구로 돌아온다.
  let closed = {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    l.local_addr().unwrap().port()
  };
  let err = tauri::async_runtime::block_on(fetch_text(&client, &format!("http://127.0.0.1:{closed}/x"))).unwrap_err();
  assert!(!err.is_empty());

  fs::remove_dir_all(&dir).unwrap();
}

// --- 보안 보강: 리다이렉트 제한·크기 상한 -------------------------------------------

#[test]
fn redirects_are_limited_to_https_github_hosts() {
  let allowed = [
    "https://github.com/sungback/cat_timer2/releases/download/v1/x.zip",
    "https://api.github.com/repos/x",
    "https://objects.githubusercontent.com/github-production-release-asset/1",
    "https://release-assets.githubusercontent.com/a/b",
    "https://GITHUB.com/x",
  ];
  for url in allowed {
    assert!(is_allowed_redirect(&reqwest::Url::parse(url).unwrap()), "{url}는 허용해야 한다");
  }
  let denied = [
    "http://github.com/x",                       // https가 아님
    "http://objects.githubusercontent.com/x",    // https가 아님
    "https://evilgithub.com/x",                  // 접미사만 같은 다른 도메인
    "https://github.com.evil.com/x",             // 호스트가 다름
    "https://notgithubusercontent.com/x",
    "https://githubusercontent.com/x",           // 하위 도메인이 아님
    "https://github.com:8443/x",                 // 기본 포트가 아님
    "https://127.0.0.1/x",
    "https://example.com/x",
    "ftp://github.com/x",
  ];
  for url in denied {
    assert!(!is_allowed_redirect(&reqwest::Url::parse(url).unwrap()), "{url}는 거부해야 한다");
  }
}

#[test]
fn production_client_refuses_redirects_to_disallowed_hosts() {
  // 로컬 서버의 /redirect는 http://127.0.0.1/file 로 넘긴다 → 운영 정책(https·GitHub 호스트만)은 거부해야 한다.
  let port = start_test_server(vec![1, 2, 3]);
  let dir = temp_case_dir("redirect-deny");
  let dest = dir.join("out.bin");
  let client = http_client(Duration::from_secs(10)).unwrap();

  let err = tauri::async_runtime::block_on(download_to(
    &client,
    &format!("http://127.0.0.1:{port}/redirect"),
    &dest,
    MAX_DOWNLOAD_BYTES,
    &mut |_, _| {},
  ))
  .unwrap_err();
  assert!(err.contains("허용되지 않은 리다이렉트"), "원인이 문구에 보여야 한다: {err}");
  assert!(!dest.exists(), "거부된 리다이렉트는 파일을 남기지 않는다");

  fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn limit_formatting_uses_mb_or_kb() {
  assert_eq!(format_limit(MAX_DOWNLOAD_BYTES), "200MB");
  assert_eq!(format_limit(MAX_CHECKSUM_BYTES), "4KB");
  assert_eq!(MAX_DOWNLOAD_BYTES, 200 * 1024 * 1024, "요청된 상한은 200MB");
}

#[test]
fn download_rejects_declared_size_above_the_limit_before_writing() {
  let body = vec![7u8; 300_000];
  let port = start_test_server(body);
  let dir = temp_case_dir("limit-declared");
  let client = http_client_with(Duration::from_secs(10), |u| u.host_str() == Some("127.0.0.1")).unwrap();
  let dest = dir.join("big.bin");
  let mut called = false;

  let err = tauri::async_runtime::block_on(download_to(
    &client,
    &format!("http://127.0.0.1:{port}/file"),
    &dest,
    100_000,
    &mut |_, _| called = true,
  ))
  .unwrap_err();
  assert!(err.contains("크기 상한"), "{err}");
  assert!(!dest.exists(), "선언된 크기가 상한을 넘으면 파일을 만들지 않는다");
  assert!(!called, "진행률도 보내지 않는다");

  fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn download_aborts_and_removes_partial_file_when_stream_exceeds_the_limit() {
  let body = vec![9u8; 300_000];
  let port = start_test_server(body);
  let dir = temp_case_dir("limit-stream");
  let client = http_client_with(Duration::from_secs(10), |u| u.host_str() == Some("127.0.0.1")).unwrap();
  let dest = dir.join("stream.bin");

  // /stream은 Content-Length 없이 보내므로 받는 도중에 상한을 넘는다.
  let err = tauri::async_runtime::block_on(download_to(
    &client,
    &format!("http://127.0.0.1:{port}/stream"),
    &dest,
    100_000,
    &mut |_, _| {},
  ))
  .unwrap_err();
  assert!(err.contains("크기 상한"), "{err}");
  assert!(!dest.exists(), "상한을 넘어 중단되면 부분 파일을 지운다");

  fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn download_limit_is_inclusive_at_the_exact_size() {
  let body = vec![1u8; 300_000];
  let port = start_test_server(body);
  let dir = temp_case_dir("limit-edge");
  let client = http_client_with(Duration::from_secs(10), |u| u.host_str() == Some("127.0.0.1")).unwrap();

  let ok = dir.join("exact.bin");
  tauri::async_runtime::block_on(download_to(
    &client,
    &format!("http://127.0.0.1:{port}/file"),
    &ok,
    300_000,
    &mut |_, _| {},
  ))
  .expect("정확히 상한과 같은 크기는 받을 수 있다");
  assert_eq!(fs::metadata(&ok).unwrap().len(), 300_000);

  let over = dir.join("over.bin");
  let err = tauri::async_runtime::block_on(download_to(
    &client,
    &format!("http://127.0.0.1:{port}/file"),
    &over,
    299_999,
    &mut |_, _| {},
  ))
  .unwrap_err();
  assert!(err.contains("크기 상한"), "{err}");
  assert!(!over.exists());

  // 같은 경계가 스트림(길이 미선언)에도 적용된다.
  let stream_ok = dir.join("stream-exact.bin");
  tauri::async_runtime::block_on(download_to(
    &client,
    &format!("http://127.0.0.1:{port}/stream"),
    &stream_ok,
    300_000,
    &mut |_, _| {},
  ))
  .expect("스트림도 정확히 상한과 같으면 받을 수 있다");

  // 스트림은 길이를 미리 알 수 없으므로, 1바이트만 넘어도 받는 도중에 막아야 한다.
  let stream_over = dir.join("stream-over.bin");
  let err = tauri::async_runtime::block_on(download_to(
    &client,
    &format!("http://127.0.0.1:{port}/stream"),
    &stream_over,
    299_999,
    &mut |_, _| {},
  ))
  .unwrap_err();
  assert!(err.contains("크기 상한"), "{err}");
  assert!(!stream_over.exists(), "1바이트 초과해도 부분 파일을 남기지 않는다");

  fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn checksum_text_is_capped_at_4kb() {
  let port = start_test_server(vec![1]);
  let client = http_client_with(Duration::from_secs(10), |u| u.host_str() == Some("127.0.0.1")).unwrap();

  let err = tauri::async_runtime::block_on(fetch_text(&client, &format!("http://127.0.0.1:{port}/bigsum"))).unwrap_err();
  assert!(err.contains("크기 상한") && err.contains("4KB"), "{err}");

  // 정상 크기의 체크섬 파일은 그대로 읽힌다.
  let text = tauri::async_runtime::block_on(fetch_text(&client, &format!("http://127.0.0.1:{port}/sum"))).unwrap();
  assert_eq!(parse_checksum(&text), "deadbeef");
}

#[test]
fn describe_error_joins_the_source_chain() {
  #[derive(Debug)]
  struct Inner;
  impl std::fmt::Display for Inner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
      write!(f, "안쪽 원인")
    }
  }
  impl std::error::Error for Inner {}
  #[derive(Debug)]
  struct Outer(Inner);
  impl std::fmt::Display for Outer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
      write!(f, "바깥 문구")
    }
  }
  impl std::error::Error for Outer {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
      Some(&self.0)
    }
  }
  assert_eq!(describe_error(&Outer(Inner)), "바깥 문구: 안쪽 원인");
  assert_eq!(describe_error(&Inner), "안쪽 원인");
}
