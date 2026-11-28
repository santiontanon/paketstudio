use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[derive(Default, Clone)]
pub struct ActiveCompiler(Arc<Mutex<Option<Child>>>);

const TEMPLATE_CPC: &str = "cpc";
const TEMPLATE_MSX: &str = "msx";
const TEMPLATE_MSX_WT: &str = "msx-wt";
const DEFAULT_COMPILER_ARGS: &str = "%MAIN% %PLATFORM% %LANG% %OUT%";
const IGNORED_NAMES: &[&str] = &[".ds_store", "thumbs.db", "desktop.ini"];
const BUILTIN_PAKET_JAR: &[u8] = include_bytes!("../../../PAKET.jar");
const BUNDLED_JAVA_PATHS: &[&str] = &[
    "../Resources/jre/bin/java",
    "jre/bin/java",
    "jre/bin/java.exe",
    "../jre/bin/java",
    "../../../editor/src-tauri/jre/bin/java",
];
const COMPILER_VERSION_PREFIX: &str = "Compiler ";
const APP_TITLE_PREFIX: &str = "PAKET Studio";
const MAIN_WINDOW_LABEL: &str = "main";
const TEMPLATES_DIR: &str = "templates";

fn get_builtin_jar_path() -> Option<String> {
    let cache_dir = std::env::temp_dir().join("paket-studio");
    let jar_path = cache_dir.join("PAKET.jar");
    if let Ok(metadata) = fs::metadata(&jar_path) {
        if metadata.len() == BUILTIN_PAKET_JAR.len() as u64 {
            return Some(jar_path.to_string_lossy().to_string());
        }
    }
    if fs::create_dir_all(&cache_dir).is_ok() && fs::write(&jar_path, BUILTIN_PAKET_JAR).is_ok() {
        Some(jar_path.to_string_lossy().to_string())
    } else {
        None
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub is_dir: bool,
    pub extension: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CompilerProblem {
    pub message: String,
    pub file: Option<String>,
    pub line: Option<usize>,
    pub raw: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CompileResponse {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub problems: Vec<CompilerProblem>,
    pub java_used: String,
    pub jar_used: String,
    pub output_dir: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemInfo {
    pub detected_java: Option<String>,
    pub detected_jar: Option<String>,
    pub detected_jar_version: Option<String>,
    pub default_project_dir: Option<String>,
}

fn detect_java(custom_path: Option<&str>, resource_dir: Option<&Path>) -> Option<String> {
    if let Some(p) = custom_path {
        let trimmed = p.trim();
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            return Some(trimmed.to_string());
        }
    }

    // Check Tauri's bundled resource directory first (works across macOS, Windows, and Linux .deb/.rpm)
    if let Some(res_dir) = resource_dir {
        for rel in ["jre/bin/java", "jre/bin/java.exe"] {
            let candidate = res_dir.join(rel);
            if let Ok(canonical) = candidate.canonicalize() {
                if canonical.is_file() {
                    return Some(canonical.to_string_lossy().to_string());
                }
            }
        }
    }

    // Check bundled minimal JRE relative to executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for rel in BUNDLED_JAVA_PATHS {
                let candidate = parent.join(rel);
                if let Ok(canonical) = candidate.canonicalize() {
                    if canonical.is_file() {
                        return Some(canonical.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        let cwd_candidates = [
            cwd.join("jre/bin/java"),
            cwd.join("src-tauri/jre/bin/java"),
            cwd.join("editor/src-tauri/jre/bin/java"),
        ];
        for c in &cwd_candidates {
            if let Ok(canonical) = c.canonicalize() {
                if canonical.is_file() {
                    return Some(canonical.to_string_lossy().to_string());
                }
            }
        }
    }

    // Check JAVA_HOME
    if let Ok(jh) = std::env::var("JAVA_HOME") {
        let bin = Path::new(&jh).join("bin").join("java");
        if bin.exists() {
            return Some(bin.to_string_lossy().to_string());
        }
    }

    // Common macOS locations (specifically Java 18+ since PAKET.jar requires Java 18)
    let mac_candidates = [
        "/Library/Java/JavaVirtualMachines/jdk-18.0.2.1.jdk/Contents/Home/bin/java",
        "/Library/Java/JavaVirtualMachines/jdk-18.jdk/Contents/Home/bin/java",
        "/Library/Java/JavaVirtualMachines/jdk-19.jdk/Contents/Home/bin/java",
        "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home/bin/java",
        "/Library/Java/JavaVirtualMachines/temurin-18.jdk/Contents/Home/bin/java",
        "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java",
        "/opt/homebrew/opt/openjdk/bin/java",
        "/usr/local/opt/openjdk/bin/java",
    ];

    for c in &mac_candidates {
        if Path::new(c).exists() {
            return Some(c.to_string());
        }
    }

    // Fallback: check if `java` in PATH is available and can run
    if let Ok(output) = Command::new("java").arg("-version").output() {
        if output.status.success() {
            return Some("java".to_string());
        }
    }

    None
}

fn detect_paket_jar(
    custom_path: Option<&str>,
    project_dir: Option<&str>,
    resource_dir: Option<&Path>,
) -> Option<String> {
    if let Some(p) = custom_path {
        let trimmed = p.trim();
        if !trimmed.is_empty() && Path::new(trimmed).exists() {
            return Some(trimmed.to_string());
        }
    }

    let mut candidates = Vec::new();

    if let Some(base) = project_dir {
        let base_path = Path::new(base);
        candidates.push(base_path.join("PAKET.jar"));
        candidates.push(base_path.join("../PAKET.jar"));
        candidates.push(base_path.join("../../PAKET.jar"));
        candidates.push(base_path.join("../../../PAKET.jar"));
    }

    if let Some(res_dir) = resource_dir {
        candidates.push(res_dir.join("PAKET.jar"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("PAKET.jar"));
            candidates.push(parent.join("../Resources/PAKET.jar"));
            candidates.push(parent.join("../../../PAKET.jar"));
            candidates.push(parent.join("../../../../PAKET.jar"));
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("PAKET.jar"));
        candidates.push(cwd.join("../PAKET.jar"));
        candidates.push(cwd.join("../../PAKET.jar"));
    }

    for c in &candidates {
        if let Ok(canonical) = c.canonicalize() {
            if canonical.exists() && canonical.is_file() {
                return Some(canonical.to_string_lossy().to_string());
            }
        }
    }

    // Fallback to embedded built-in jar
    get_builtin_jar_path()
}

fn detect_paket_jar_version(java_bin: Option<&str>, jar_path: Option<&str>) -> Option<String> {
    let java = java_bin?;
    let jar = jar_path?;
    let output = Command::new(java)
        .arg("-jar")
        .arg(jar)
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if let Some(pos) = line.find(COMPILER_VERSION_PREFIX) {
            let ver = line[pos + COMPILER_VERSION_PREFIX.len()..].trim();
            if !ver.is_empty() {
                return Some(ver.to_string());
            }
        }
    }
    None
}

#[tauri::command]
fn get_system_info(
    app: tauri::AppHandle,
    project_dir: Option<String>,
    custom_java: Option<String>,
    custom_jar: Option<String>,
) -> SystemInfo {
    let resource_dir = app.path().resource_dir().ok();
    let java = detect_java(custom_java.as_deref(), resource_dir.as_deref());
    let jar = detect_paket_jar(custom_jar.as_deref(), project_dir.as_deref(), resource_dir.as_deref());
    let jar_version = detect_paket_jar_version(java.as_deref(), jar.as_deref());
    let default_dir = std::env::current_dir().ok().map(|d| {
        let s = d.to_string_lossy().to_string();
        if s.ends_with("/src-tauri") {
            d.parent().and_then(|p| p.parent()).unwrap_or(&d).to_string_lossy().to_string()
        } else if s.ends_with("/editor") {
            d.parent().unwrap_or(&d).to_string_lossy().to_string()
        } else {
            s
        }
    });

    SystemInfo {
        detected_java: java,
        detected_jar: jar,
        detected_jar_version: jar_version,
        default_project_dir: default_dir,
    }
}

#[tauri::command]
fn pick_folder() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("osascript")
            .arg("-e")
            .arg("POSIX path of (choose folder with prompt \"Select PAKET Project Folder\")")
            .output()
            .map_err(|e| format!("Failed to run osascript: {}", e))?;

        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return Ok(Some(path_str));
            }
        }
        Ok(None)
    }

    #[cfg(target_os = "windows")]
    {
        let ps_cmd = r#"[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }"#;
        let output = Command::new("powershell")
            .arg("-NoProfile")
            .arg("-Command")
            .arg(ps_cmd)
            .output()
            .map_err(|e| format!("Failed to open folder picker: {}", e))?;

        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                return Ok(Some(path_str));
            }
        }
        Ok(None)
    }

    #[cfg(target_os = "linux")]
    {
        if let Ok(out) = Command::new("zenity")
            .arg("--file-selection")
            .arg("--directory")
            .output()
        {
            if out.status.success() {
                let path_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path_str.is_empty() {
                    return Ok(Some(path_str));
                }
            }
            return Ok(None);
        }

        if let Ok(out) = Command::new("kdialog")
            .arg("--getexistingdirectory")
            .arg(".")
            .output()
        {
            if out.status.success() {
                let path_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path_str.is_empty() {
                    return Ok(Some(path_str));
                }
            }
            return Ok(None);
        }

        Err("No folder picker dialog available. Please install zenity or kdialog.".to_string())
    }
}

#[tauri::command]
fn create_project(
    app: tauri::AppHandle,
    parent_dir: String,
    project_name: String,
    platform: String,
) -> Result<String, String> {
    let resolved_parent = if parent_dir.starts_with("~/") || parent_dir == "~" {
        if let Ok(home) = std::env::var("HOME") {
            parent_dir.replacen('~', &home, 1)
        } else {
            parent_dir.clone()
        }
    } else {
        parent_dir.clone()
    };

    let parent = Path::new(&resolved_parent);
    if !parent.exists() {
        fs::create_dir_all(&parent)
            .map_err(|e| format!("Destination directory could not be created: {}", e))?;
    }

    let target_dir = parent.join(&project_name);
    if target_dir.exists() {
        return Err(format!("A folder named '{}' already exists in {}", project_name, resolved_parent));
    }

    // Determine template subdirectory
    let template_sub = match platform.as_str() {
        "msx-wt" => TEMPLATE_MSX_WT,
        "msx" | "msxmegarom" => TEMPLATE_MSX,
        _ => TEMPLATE_CPC,
    };

    // Locate templates directory (check Tauri's bundled resource dir first across all platforms)
    let mut candidate_dirs = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidate_dirs.push(resource_dir.join(TEMPLATES_DIR).join(template_sub));
    }
    candidate_dirs.extend([
        PathBuf::from(TEMPLATES_DIR).join(template_sub),
        PathBuf::from("..").join(TEMPLATES_DIR).join(template_sub),
        PathBuf::from("../..").join(TEMPLATES_DIR).join(template_sub),
    ]);

    if let Ok(cwd) = std::env::current_dir() {
        candidate_dirs.push(cwd.join("templates").join(template_sub));
        candidate_dirs.push(cwd.join("editor/templates").join(template_sub));
        candidate_dirs.push(cwd.join("../editor/templates").join(template_sub));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidate_dirs.push(parent.join("templates").join(template_sub));
            candidate_dirs.push(parent.join("../templates").join(template_sub));
            candidate_dirs.push(parent.join("../../templates").join(template_sub));
            candidate_dirs.push(parent.join("../../../templates").join(template_sub));
            candidate_dirs.push(parent.join("../../../editor/templates").join(template_sub));
            candidate_dirs.push(parent.join("../Resources/templates").join(template_sub));
        }
    }

    let mut found_template = None;
    for c in &candidate_dirs {
        if c.exists() && c.is_dir() {
            found_template = Some(c.clone());
            break;
        }
    }

    let template_dir = found_template
        .ok_or_else(|| format!("Could not find template directory for platform '{}'", platform))?;

    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("Failed to create project folder: {}", e))?;

    // Copy template files
    let entries = fs::read_dir(&template_dir)
        .map_err(|e| format!("Failed to read template directory: {}", e))?;

    for entry in entries.flatten() {
        let p = entry.path();
        let fname = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        let lower = fname.to_lowercase();
        if fname.starts_with('.') || IGNORED_NAMES.contains(&lower.as_str()) {
            continue;
        }
        let dest = target_dir.join(&fname);
        if p.is_file() {
            fs::copy(&p, &dest)
                .map_err(|e| format!("Failed to copy {}: {}", fname, e))?;
        }
    }

    Ok(target_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn list_project_files(project_path: String) -> Result<Vec<FileNode>, String> {
    let root = Path::new(&project_path);
    if !root.exists() {
        return Err(format!("Path does not exist: {}", project_path));
    }

    let mut result = Vec::new();
    fn visit(dir: &Path, root: &Path, acc: &mut Vec<FileNode>) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let p = entry.path();
            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();

            // Skip hidden files/directories, OS metadata, and build output dirs
            let lower = name.to_lowercase();
            if name.starts_with('.') 
                || IGNORED_NAMES.contains(&lower.as_str())
                || name == "node_modules" 
                || name == "target" 
                || name == "built" 
            {
                continue;
            }

            let is_dir = p.is_dir();
            let ext = p.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            let size = if is_dir { 0 } else { p.metadata().map(|m| m.len()).unwrap_or(0) };
            let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().to_string();

            acc.push(FileNode {
                name,
                path: p.to_string_lossy().to_string(),
                relative_path: rel,
                is_dir,
                extension: ext,
                size,
            });

            if is_dir {
                visit(&p, root, acc)?;
            }
        }
        Ok(())
    }

    visit(root, root, &mut result)?;
    Ok(result)
}

#[tauri::command]
fn read_text_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(&file_path).map_err(|e| format!("Failed to read {}: {}", file_path, e))
}

fn to_base64(bytes: &[u8]) -> String {
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 { chunk[1] as usize } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as usize } else { 0 };

        out.push(CHARSET[b0 >> 2] as char);
        out.push(CHARSET[((b0 & 3) << 4) | (b1 >> 4)] as char);
        if chunk.len() > 1 {
            out.push(CHARSET[((b1 & 15) << 2) | (b2 >> 6)] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARSET[b2 & 63] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[tauri::command]
fn read_file_base64(file_path: String) -> Result<String, String> {
    let bytes = fs::read(&file_path).map_err(|e| format!("Failed to read {}: {}", file_path, e))?;
    let b64 = to_base64(&bytes);
    let lower = file_path.to_lowercase();
    let mime = if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else {
        "application/octet-stream"
    };
    Ok(format!("data:{};base64,{}", mime, b64))
}

fn from_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut table = [255u8; 256];
    const CHARSET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (i, &b) in CHARSET.iter().enumerate() {
        table[b as usize] = i as u8;
    }
    let clean: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if clean.len() % 4 != 0 {
        return Err("Invalid base64 length".to_string());
    }
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.chunks(4) {
        let b0 = table[chunk[0] as usize];
        let b1 = table[chunk[1] as usize];
        let b2 = if chunk[2] == b'=' { 0 } else { table[chunk[2] as usize] };
        let b3 = if chunk[3] == b'=' { 0 } else { table[chunk[3] as usize] };
        if b0 == 255 || b1 == 255 || (chunk[2] != b'=' && b2 == 255) || (chunk[3] != b'=' && b3 == 255) {
            return Err("Invalid base64 character".to_string());
        }
        out.push((b0 << 2) | (b1 >> 4));
        if chunk[2] != b'=' {
            out.push(((b1 & 0x0F) << 4) | (b2 >> 2));
        }
        if chunk[3] != b'=' {
            out.push(((b2 & 0x03) << 6) | b3);
        }
    }
    Ok(out)
}

#[tauri::command]
fn write_file_base64(file_path: String, base64_data: String) -> Result<(), String> {
    let raw = match base64_data.find(',') {
        Some(idx) => &base64_data[idx + 1..],
        None => &base64_data,
    };
    let bytes = from_base64(raw)?;
    if let Some(parent) = Path::new(&file_path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories for {}: {}", file_path, e))?;
        }
    }
    fs::write(&file_path, bytes).map_err(|e| format!("Failed to write {}: {}", file_path, e))
}

#[tauri::command]
fn write_text_file(file_path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&file_path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories for {}: {}", file_path, e))?;
        }
    }
    fs::write(&file_path, content).map_err(|e| format!("Failed to write {}: {}", file_path, e))
}

#[tauri::command]
fn delete_file(file_path: String) -> Result<(), String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory {}: {}", file_path, e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file {}: {}", file_path, e))
    }
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let src = PathBuf::from(&old_path);
    let dest = PathBuf::from(&new_path);
    if !src.exists() {
        return Err(format!("Source does not exist: {}", old_path));
    }
    if dest.exists() {
        return Err(format!("Destination already exists: {}", new_path));
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }
    fs::rename(&src, &dest).map_err(|e| format!("Failed to rename {} to {}: {}", old_path, new_path, e))
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if let Some(&'[') = chars.peek() {
                chars.next(); // consume '['
                while let Some(&next_c) = chars.peek() {
                    chars.next();
                    if next_c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn parse_compiler_errors(output: &str) -> Vec<CompilerProblem> {
    let clean = strip_ansi(output);
    let mut problems = Vec::new();

    for line in clean.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("ERROR:") {
            let err_content = trimmed.trim_start_matches("ERROR:").trim();

            // Matches e.g. "Unexpected token invalid_command in /path/to/file.pak line 1"
            if let Some(line_idx) = err_content.rfind(" line ") {
                let before_line = &err_content[..line_idx];
                if let Some(in_idx) = before_line.rfind(" in ") {
                    let msg = before_line[..in_idx].trim().to_string();
                    let file_part = before_line[in_idx + 4..].trim().to_string();
                    let line_str = err_content[line_idx + 6..].trim();
                    let line_num = line_str.parse::<usize>().ok();

                    problems.push(CompilerProblem {
                        message: msg,
                        file: Some(file_part),
                        line: line_num,
                        raw: trimmed.to_string(),
                    });
                    continue;
                }
            }

            // General error line without specific line coordinates
            problems.push(CompilerProblem {
                message: err_content.to_string(),
                file: None,
                line: None,
                raw: trimmed.to_string(),
            });
        } else if trimmed.contains("Exception in thread") || trimmed.contains("Error:") {
            problems.push(CompilerProblem {
                message: trimmed.to_string(),
                file: None,
                line: None,
                raw: trimmed.to_string(),
            });
        }
    }

    problems
}

#[tauri::command]
fn kill_compile(state: tauri::State<'_, ActiveCompiler>) -> Result<(), String> {
    let mut lock = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
async fn compile_game(
    app: tauri::AppHandle,
    state: tauri::State<'_, ActiveCompiler>,
    on_output: tauri::ipc::Channel<String>,
    project_dir: String,
    main_pak: String,
    platform: String,
    language: String,
    output_dir: String,
    compiler_args: Option<String>,
    java_path: Option<String>,
    jar_path: Option<String>,
) -> Result<CompileResponse, String> {
    let active_compiler = state.inner().clone();
    let resource_dir = app.path().resource_dir().ok();

    tauri::async_runtime::spawn_blocking(move || {
        // Kill previous compiler if still running
        {
            let mut lock = active_compiler.0.lock().map_err(|e| e.to_string())?;
            if let Some(mut existing) = lock.take() {
                let _ = existing.kill();
                let _ = existing.wait();
            }
        }

    let java_bin = detect_java(java_path.as_deref(), resource_dir.as_deref())
        .ok_or_else(|| "No Java binary found. PAKET requires Java 18+. Please configure the Java path in Settings.".to_string())?;

    let jar = detect_paket_jar(jar_path.as_deref(), Some(&project_dir), resource_dir.as_deref())
        .ok_or_else(|| "Could not find PAKET.jar. Please specify the path in Settings.".to_string())?;

    let proj_path = Path::new(&project_dir);
    if !proj_path.exists() {
        return Err(format!("Project directory does not exist: {}", project_dir));
    }

    let raw_args = compiler_args
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_COMPILER_ARGS.to_string());

    let expanded_args = raw_args
        .replace("%MAIN%", &main_pak)
        .replace("%PLATFORM%", &platform)
        .replace("%LANG%", &language)
        .replace("%OUT%", &output_dir);

    // Execute: java -jar <jar> <expanded_args...>
    let mut cmd = Command::new(&java_bin);
    cmd.current_dir(proj_path);
    cmd.arg("-jar");
    cmd.arg(&jar);
    for arg in expanded_args.split_whitespace() {
        cmd.arg(arg);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn compiler process: {}", e))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    {
        let mut lock = active_compiler.0.lock().map_err(|e| e.to_string())?;
        *lock = Some(child);
    }

    let stdout_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));

    let sl = stdout_lines.clone();
    let ch_out = on_output.clone();
    let stdout_thread = std::thread::spawn(move || {
        if let Some(pipe) = stdout {
            let reader = BufReader::new(pipe);
            for line in reader.lines() {
                if let Ok(l) = line {
                    let _ = ch_out.send(l.clone());
                    if let Ok(mut lock) = sl.lock() {
                        lock.push(l);
                    }
                }
            }
        }
    });

    let se = stderr_lines.clone();
    let ch_err = on_output.clone();
    let stderr_thread = std::thread::spawn(move || {
        if let Some(pipe) = stderr {
            let reader = BufReader::new(pipe);
            for line in reader.lines() {
                if let Ok(l) = line {
                    let _ = ch_err.send(l.clone());
                    if let Ok(mut lock) = se.lock() {
                        lock.push(l);
                    }
                }
            }
        }
    });

    let mut was_killed = false;
    let mut exit_code = None;

        loop {
            let mut lock = active_compiler.0.lock().map_err(|e| e.to_string())?;
            if let Some(child) = lock.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        exit_code = status.code();
                        lock.take();
                        break;
                    }
                    Ok(None) => {}
                    Err(_) => {
                        lock.take();
                        break;
                    }
                }
            } else {
                was_killed = true;
                break;
            }
            drop(lock);
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        let _ = stdout_thread.join();
        let _ = stderr_thread.join();

        let stdout_str = stdout_lines.lock().map(|l| l.join("\n")).unwrap_or_default();
        let stderr_str = stderr_lines.lock().map(|l| l.join("\n")).unwrap_or_default();
        let full_log = if stderr_str.is_empty() {
            stdout_str.clone()
        } else {
            format!("{}\n{}", stdout_str, stderr_str)
        };

        if was_killed {
            return Ok(CompileResponse {
                success: false,
                exit_code: None,
                stdout: stdout_str,
                stderr: "Compilation cancelled by user.".to_string(),
                problems: vec![CompilerProblem {
                    message: "Compilation cancelled by user.".to_string(),
                    file: None,
                    line: None,
                    raw: "Compilation cancelled by user.".to_string(),
                }],
                java_used: java_bin,
                jar_used: jar,
                output_dir,
            });
        }

        let clean_log = strip_ansi(&full_log);
        let problems = parse_compiler_errors(&clean_log);
        let success = exit_code == Some(0) && !clean_log.contains("ERROR: Compilation failed");

        Ok(CompileResponse {
            success,
            exit_code,
            stdout: stdout_str,
            stderr: stderr_str,
            problems,
            java_used: java_bin,
            jar_used: jar,
            output_dir,
        })
    })
    .await
    .map_err(|e| format!("Compiler task failed: {}", e))?
}

#[tauri::command]
fn run_emulator(emulator_cmd: String, working_dir: String, target_file: String) -> Result<String, String> {
    if emulator_cmd.trim().is_empty() {
        return Err("Empty emulator command".to_string());
    }

    if emulator_cmd.contains("%FILE%") && !target_file.is_empty() {
        let p = Path::new(&target_file);
        let exists = if p.is_absolute() {
            p.exists()
        } else if !working_dir.is_empty() {
            Path::new(&working_dir).join(p).exists()
        } else {
            p.exists()
        };
        if !exists {
            return Err(format!(
                "Target binary does not exist yet: '{}'. Please compile the project first (F5).",
                target_file
            ));
        }
    }

    let file_replacement = if (emulator_cmd.contains("\"%FILE%\"") || emulator_cmd.contains("'%FILE%'"))
        || !target_file.contains(' ') {
        target_file.clone()
    } else {
        format!("\"{}\"", target_file)
    };
    let cmd_str = emulator_cmd.replace("%FILE%", &file_replacement);

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", &cmd_str]);
        c
    };

    #[cfg(not(target_os = "windows"))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-c", &cmd_str]);
        c
    };

    if !working_dir.is_empty() {
        cmd.current_dir(Path::new(&working_dir));
    }

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn emulator process: {}", e))?;

    // Check if the command immediately exits with error (e.g. invalid path or syntax)
    std::thread::sleep(std::time::Duration::from_millis(150));
    match child.try_wait() {
        Ok(Some(status)) if !status.success() => {
            let code = status.code().unwrap_or(-1);
            return Err(format!(
                "Emulator command exited immediately with error code {}.\nPlease check the program path and arguments.\nCommand: {}",
                code, cmd_str
            ));
        }
        _ => {}
    }

    Ok(format!("Launched emulator: {}", cmd_str))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ActiveCompiler::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let title = format!("{} v{}", APP_TITLE_PREFIX, app.package_info().version);
                let _ = window.set_title(&title);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_info,
            pick_folder,
            create_project,
            list_project_files,
            read_text_file,
            read_file_base64,
            write_file_base64,
            write_text_file,
            compile_game,
            kill_compile,
            run_emulator,
            delete_file,
            rename_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
