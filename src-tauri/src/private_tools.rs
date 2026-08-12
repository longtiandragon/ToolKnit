use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

const MANIFEST_MAX_BYTES: u64 = 512 * 1024;
const LOG_MAX_BYTES: usize = 512 * 1024;
const MAX_TOOLS: usize = 64;
const MAX_OPERATIONS_PER_TOOL: usize = 32;
const MAX_FIELDS_PER_OPERATION: usize = 48;

#[derive(Clone, Default)]
pub struct PrivateToolRunState {
    cancelled: Arc<Mutex<HashSet<String>>>,
    active: Arc<Mutex<HashSet<String>>>,
}

impl PrivateToolRunState {
    pub fn begin(&self, run_id: &str) -> Result<(), String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "私人工具执行状态不可用".to_string())?;
        if !active.insert(run_id.to_owned()) {
            return Err("同一个工具任务正在执行".into());
        }
        self.cancelled
            .lock()
            .map_err(|_| "私人工具执行状态不可用".to_string())?
            .remove(run_id);
        Ok(())
    }

    pub fn finish(&self, run_id: &str) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(run_id);
        }
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(run_id);
        }
    }

    pub fn cancel(&self, run_id: &str) -> Result<(), String> {
        let active = self
            .active
            .lock()
            .map_err(|_| "私人工具执行状态不可用".to_string())?;
        if !active.contains(run_id) {
            return Err("没有找到正在执行的任务".into());
        }
        drop(active);
        self.cancelled
            .lock()
            .map_err(|_| "私人工具执行状态不可用".to_string())?
            .insert(run_id.to_owned());
        Ok(())
    }

    fn is_cancelled(&self, run_id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|items| items.contains(run_id))
            .unwrap_or(false)
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivateToolsManifest {
    version: u32,
    tools: Vec<PrivateToolDefinition>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrivateToolDefinition {
    id: String,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_icon")]
    icon: String,
    executable: String,
    #[serde(default)]
    working_directory: Option<String>,
    operations: Vec<PrivateToolOperation>,
}

fn default_icon() -> String {
    "terminal".into()
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateToolOperation {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub risk: PrivateToolRisk,
    #[serde(default)]
    pub confirmation_text: String,
    #[serde(default)]
    pub fields: Vec<PrivateToolField>,
    #[serde(skip_serializing, default)]
    arguments: Vec<String>,
    #[serde(skip_serializing, default)]
    preview_arguments: Option<Vec<String>>,
}

#[derive(Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PrivateToolRisk {
    #[default]
    ReadOnly,
    ChangesFiles,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateToolField {
    pub key: String,
    pub label: String,
    #[serde(default = "default_field_kind")]
    pub kind: String,
    #[serde(default)]
    pub placeholder: String,
    #[serde(default)]
    pub help: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default_value: String,
    #[serde(default)]
    pub options: Vec<PrivateToolOption>,
    #[serde(default)]
    pub min: Option<i64>,
    #[serde(default)]
    pub max: Option<i64>,
}

fn default_field_kind() -> String {
    "text".into()
}

#[derive(Clone, Deserialize, Serialize)]
pub struct PrivateToolOption {
    pub label: String,
    pub value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateToolsCatalog {
    pub version: u32,
    pub tools: Vec<PrivateToolPublicDefinition>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateToolPublicDefinition {
    pub id: String,
    pub title: String,
    pub description: String,
    pub icon: String,
    pub operations: Vec<PrivateToolOperation>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateToolRunResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub payload: Option<Value>,
    pub elapsed_ms: u128,
    pub log_truncated: bool,
}

pub fn load_catalog(manifest_path: &str) -> Result<PrivateToolsCatalog, String> {
    let manifest = load_manifest(manifest_path)?;
    Ok(PrivateToolsCatalog {
        version: manifest.version,
        tools: manifest
            .tools
            .into_iter()
            .map(|tool| PrivateToolPublicDefinition {
                id: tool.id,
                title: tool.title,
                description: tool.description,
                icon: tool.icon,
                operations: tool.operations,
            })
            .collect(),
    })
}

pub fn run_tool(
    manifest_path: &str,
    tool_id: &str,
    operation_id: &str,
    input: Value,
    run_id: &str,
    mode: &str,
    confirmed: bool,
    state: PrivateToolRunState,
) -> Result<PrivateToolRunResult, String> {
    validate_id(run_id, "任务标识")?;
    let manifest = load_manifest(manifest_path)?;
    let tool = manifest
        .tools
        .into_iter()
        .find(|tool| tool.id == tool_id)
        .ok_or("没有找到指定的私人工具")?;
    let operation = tool
        .operations
        .iter()
        .find(|operation| operation.id == operation_id)
        .ok_or("没有找到指定的工具操作")?;
    let template = match mode {
        "preview" => operation
            .preview_arguments
            .as_ref()
            .ok_or("这个操作没有配置安全预览。请在清单中添加 previewArguments。")?,
        "apply" => {
            if operation.risk == PrivateToolRisk::ChangesFiles && !confirmed {
                return Err("该操作会修改文件，必须在预览后明确确认。".into());
            }
            &operation.arguments
        }
        _ => return Err("未知的私人工具执行模式".into()),
    };
    if template.is_empty() {
        return Err("工具清单没有为这个操作提供命令参数".into());
    }
    let values = input.as_object().ok_or("工具参数必须是对象")?;
    let arguments = render_arguments(template, &operation.fields, values)?;
    if state.is_cancelled(run_id) {
        return Err("任务已取消".into());
    }
    execute(tool, arguments, run_id, state)
}

pub fn cancel_tool_run(run_id: &str, state: &PrivateToolRunState) -> Result<(), String> {
    validate_id(run_id, "任务标识")?;
    state.cancel(run_id)
}

fn load_manifest(manifest_path: &str) -> Result<PrivateToolsManifest, String> {
    let path = PathBuf::from(manifest_path);
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_none_or(|extension| !extension.eq_ignore_ascii_case("json"))
    {
        return Err("私人工具清单必须是 JSON 文件".into());
    }
    let metadata = fs::metadata(&path).map_err(|_| "私人工具清单不存在或无法读取".to_string())?;
    if !metadata.is_file() || metadata.len() > MANIFEST_MAX_BYTES {
        return Err("私人工具清单不是普通文件或超过 512 KB".into());
    }
    let source =
        fs::read_to_string(&path).map_err(|error| format!("无法读取私人工具清单：{error}"))?;
    let manifest: PrivateToolsManifest = serde_json::from_str(&source)
        .map_err(|error| format!("私人工具清单 JSON 无效：{error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &PrivateToolsManifest) -> Result<(), String> {
    if manifest.version != 1 {
        return Err("目前只支持 version: 1 的私人工具清单".into());
    }
    if manifest.tools.is_empty() {
        return Err("私人工具清单中没有工具".into());
    }
    if manifest.tools.len() > MAX_TOOLS {
        return Err(format!("私人工具清单最多包含 {MAX_TOOLS} 个工具"));
    }
    let mut ids = HashSet::new();
    for tool in &manifest.tools {
        validate_id(&tool.id, "工具 ID")?;
        if !ids.insert(&tool.id) {
            return Err(format!("私人工具 ID 重复：{}", tool.id));
        }
        if tool.title.trim().is_empty()
            || tool.executable.trim().is_empty()
            || tool.executable.contains('\0')
        {
            return Err(format!("工具 {} 缺少名称或可执行程序", tool.id));
        }
        if let Some(directory) = &tool.working_directory {
            if directory.contains('\0') || !Path::new(directory).is_dir() {
                return Err(format!("工具 {} 的工作目录不存在", tool.id));
            }
        }
        if tool.operations.is_empty() {
            return Err(format!("工具 {} 没有操作", tool.id));
        }
        if tool.operations.len() > MAX_OPERATIONS_PER_TOOL {
            return Err(format!(
                "工具 {} 最多包含 {MAX_OPERATIONS_PER_TOOL} 个操作",
                tool.id
            ));
        }
        let mut operation_ids = HashSet::new();
        for operation in &tool.operations {
            validate_id(&operation.id, "操作 ID")?;
            if !operation_ids.insert(&operation.id) {
                return Err(format!("工具 {} 的操作 ID 重复：{}", tool.id, operation.id));
            }
            if operation.title.trim().is_empty() || operation.arguments.is_empty() {
                return Err(format!(
                    "工具 {} 的操作 {} 缺少名称或命令参数",
                    tool.id, operation.id
                ));
            }
            if operation.risk == PrivateToolRisk::ChangesFiles
                && operation
                    .preview_arguments
                    .as_ref()
                    .is_none_or(Vec::is_empty)
            {
                return Err(format!(
                    "工具 {} 的操作 {} 会修改文件，必须配置 previewArguments",
                    tool.id, operation.id
                ));
            }
            if operation.fields.len() > MAX_FIELDS_PER_OPERATION {
                return Err(format!(
                    "工具 {} 的操作 {} 最多包含 {MAX_FIELDS_PER_OPERATION} 个字段",
                    tool.id, operation.id
                ));
            }
            let mut field_ids = HashSet::new();
            for field in &operation.fields {
                validate_id(&field.key, "字段 ID")?;
                if field.label.trim().is_empty() || !field_ids.insert(&field.key) {
                    return Err(format!("工具 {} 的字段配置无效", tool.id));
                }
                if !matches!(
                    field.kind.as_str(),
                    "text" | "integer" | "file" | "directory" | "select"
                ) {
                    return Err(format!(
                        "字段 {} 使用了不支持的类型 {}",
                        field.key, field.kind
                    ));
                }
                if field.min.zip(field.max).is_some_and(|(min, max)| min > max) {
                    return Err(format!("字段 {} 的最小值不能大于最大值", field.key));
                }
                if field.kind == "select" {
                    if field.options.is_empty() {
                        return Err(format!("字段 {} 至少需要一个选项", field.key));
                    }
                    let mut option_values = HashSet::new();
                    if field.options.iter().any(|option| {
                        option.label.trim().is_empty()
                            || option.value.is_empty()
                            || option.value.contains('\0')
                            || !option_values.insert(&option.value)
                    }) {
                        return Err(format!("字段 {} 的选项配置无效或重复", field.key));
                    }
                }
            }
            validate_template(&operation.arguments, &field_ids)?;
            if let Some(template) = &operation.preview_arguments {
                validate_template(template, &field_ids)?;
            }
        }
    }
    Ok(())
}

fn validate_template(template: &[String], fields: &HashSet<&String>) -> Result<(), String> {
    for item in template {
        if item.contains('\0') || item.len() > 32 * 1024 {
            return Err("工具命令参数包含不安全字符或过长".into());
        }
        if item.starts_with("${") || item.ends_with('}') {
            let field = item
                .strip_prefix("${")
                .and_then(|value| value.strip_suffix('}'))
                .ok_or("变量必须独占一个命令参数，例如 ${inputFile}")?;
            if !fields.iter().any(|candidate| candidate.as_str() == field) {
                return Err(format!("命令引用了未定义字段：{field}"));
            }
        }
    }
    Ok(())
}

fn validate_id(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(format!("{label} 只能包含字母、数字、连字符和下划线"));
    }
    Ok(())
}

fn render_arguments(
    template: &[String],
    fields: &[PrivateToolField],
    values: &Map<String, Value>,
) -> Result<Vec<String>, String> {
    template
        .iter()
        .map(|item| {
            let Some(key) = item
                .strip_prefix("${")
                .and_then(|value| value.strip_suffix('}'))
            else {
                return Ok(item.clone());
            };
            let field = fields
                .iter()
                .find(|field| field.key == key)
                .ok_or("工具清单字段不存在")?;
            let value = values
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or(&field.default_value)
                .trim()
                .to_owned();
            validate_value(field, &value)?;
            Ok(value)
        })
        .collect()
}

fn validate_value(field: &PrivateToolField, value: &str) -> Result<(), String> {
    if value.contains('\0') || value.len() > 32 * 1024 {
        return Err(format!("{} 包含不支持的字符或过长", field.label));
    }
    if field.required && value.is_empty() {
        return Err(format!("请填写{}", field.label));
    }
    if value.is_empty() {
        return Ok(());
    }
    if field.kind == "integer" {
        let number = value
            .parse::<i64>()
            .map_err(|_| format!("{}必须是整数", field.label))?;
        if field.min.is_some_and(|minimum| number < minimum)
            || field.max.is_some_and(|maximum| number > maximum)
        {
            return Err(format!("{}不在允许范围内", field.label));
        }
    }
    if field.kind == "select" && !field.options.iter().any(|option| option.value == value) {
        return Err(format!("{}的选项无效", field.label));
    }
    if matches!(field.kind.as_str(), "file" | "directory") && !Path::new(value).exists() {
        return Err(format!("{}不存在", field.label));
    }
    if field.kind == "file" && !Path::new(value).is_file() {
        return Err(format!("{}不是文件", field.label));
    }
    if field.kind == "directory" && !Path::new(value).is_dir() {
        return Err(format!("{}不是目录", field.label));
    }
    Ok(())
}

fn execute(
    tool: PrivateToolDefinition,
    arguments: Vec<String>,
    run_id: &str,
    state: PrivateToolRunState,
) -> Result<PrivateToolRunResult, String> {
    let started = Instant::now();
    let mut command = Command::new(&tool.executable);
    command
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(directory) = &tool.working_directory {
        command.current_dir(directory);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 {}：{error}", tool.title))?;
    let stdout = child.stdout.take().ok_or("无法读取工具标准输出")?;
    let stderr = child.stderr.take().ok_or("无法读取工具错误输出")?;
    let stdout_reader = thread::spawn(move || read_capped(stdout));
    let stderr_reader = thread::spawn(move || read_capped(stderr));
    let status = loop {
        if state.is_cancelled(run_id) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("任务已取消，工具进程已停止。".into());
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查工具状态：{error}"))?
        {
            break status;
        }
        thread::sleep(Duration::from_millis(60));
    };
    let (stdout, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| "无法读取工具标准输出".to_string())?;
    let (stderr, stderr_truncated) = stderr_reader
        .join()
        .map_err(|_| "无法读取工具错误输出".to_string())?;
    let exit_code = status.code().unwrap_or(-1);
    if !status.success() {
        return Ok(PrivateToolRunResult {
            exit_code,
            stdout,
            stderr,
            payload: None,
            elapsed_ms: started.elapsed().as_millis(),
            log_truncated: stdout_truncated || stderr_truncated,
        });
    }
    let payload = parse_tool_payload(&stdout, stdout_truncated)?;
    Ok(PrivateToolRunResult {
        exit_code,
        stdout,
        stderr,
        payload: Some(payload),
        elapsed_ms: started.elapsed().as_millis(),
        log_truncated: stdout_truncated || stderr_truncated,
    })
}

fn parse_tool_payload(stdout: &str, stdout_truncated: bool) -> Result<Value, String> {
    if stdout_truncated {
        return Err("工具标准输出超过 512 KB，已停止解析；请让脚本返回摘要而非完整列表。".into());
    }
    let payload = serde_json::from_str::<Value>(stdout.trim())
        .map_err(|_| "工具必须从标准输出返回单个 JSON 对象。".to_string())?;
    let payload_object = payload
        .as_object()
        .ok_or("工具必须从标准输出返回 JSON 对象。")?;
    if payload_object.get("ok").and_then(Value::as_bool) == Some(false) {
        let detail = payload_object
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("工具返回了失败状态");
        return Err(detail.to_string());
    }
    Ok(payload)
}

fn read_capped<R: Read>(mut reader: R) -> (String, bool) {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 8192];
    let mut truncated = false;
    loop {
        match reader.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(length) => {
                let remaining = LOG_MAX_BYTES.saturating_sub(bytes.len());
                if remaining == 0 {
                    truncated = true;
                    continue;
                }
                let copied = length.min(remaining);
                bytes.extend_from_slice(&chunk[..copied]);
                if copied < length {
                    truncated = true;
                }
            }
        }
    }
    (String::from_utf8_lossy(&bytes).into_owned(), truncated)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(key: &str, kind: &str) -> PrivateToolField {
        PrivateToolField {
            key: key.into(),
            label: key.into(),
            kind: kind.into(),
            placeholder: String::new(),
            help: String::new(),
            required: true,
            default_value: String::new(),
            options: vec![],
            min: None,
            max: None,
        }
    }

    #[test]
    fn renders_exact_template_variables_without_a_shell() {
        let values = serde_json::json!({ "file": "C:\\demo\\input.txt", "count": "12" });
        let args = render_arguments(
            &[
                "script.py".into(),
                "--file".into(),
                "${file}".into(),
                "--count".into(),
                "${count}".into(),
            ],
            &[field("file", "text"), field("count", "integer")],
            values.as_object().unwrap(),
        )
        .unwrap();
        assert_eq!(
            args,
            [
                "script.py",
                "--file",
                "C:\\demo\\input.txt",
                "--count",
                "12"
            ]
        );
    }

    #[test]
    fn rejects_missing_required_and_non_integer_values() {
        let values = serde_json::json!({ "count": "twelve" });
        assert!(render_arguments(
            &["${count}".into()],
            &[field("count", "integer")],
            values.as_object().unwrap()
        )
        .is_err());
        assert!(render_arguments(
            &["${file}".into()],
            &[field("file", "text")],
            values.as_object().unwrap()
        )
        .is_err());
    }

    #[test]
    fn accepts_only_successful_json_object_payloads() {
        assert!(parse_tool_payload(r#"{"ok": true, "matchedCount": 12}"#, false).is_ok());
        assert!(parse_tool_payload("human-readable output", false).is_err());
        assert!(parse_tool_payload(r#"{"ok": false, "error": "bad input"}"#, false).is_err());
        assert!(parse_tool_payload(r#"{"ok": true}"#, true).is_err());
    }

    #[test]
    fn changes_files_operations_require_a_real_preview_plan() {
        let manifest = PrivateToolsManifest {
            version: 1,
            tools: vec![PrivateToolDefinition {
                id: "organizer".into(),
                title: "整理".into(),
                description: String::new(),
                icon: default_icon(),
                executable: "python".into(),
                working_directory: None,
                operations: vec![PrivateToolOperation {
                    id: "apply".into(),
                    title: "执行".into(),
                    description: String::new(),
                    risk: PrivateToolRisk::ChangesFiles,
                    confirmation_text: String::new(),
                    fields: vec![],
                    arguments: vec!["script.py".into()],
                    preview_arguments: None,
                }],
            }],
        };
        assert!(validate_manifest(&manifest)
            .unwrap_err()
            .contains("必须配置 previewArguments"));
    }

    #[test]
    fn manifest_selects_and_numeric_ranges_must_be_coherent() {
        let mut select = field("mode", "select");
        select.options = vec![
            PrivateToolOption {
                label: "安全".into(),
                value: "safe".into(),
            },
            PrivateToolOption {
                label: "重复".into(),
                value: "safe".into(),
            },
        ];
        let mut numeric = field("count", "integer");
        numeric.min = Some(10);
        numeric.max = Some(2);
        let operation = |fields| PrivateToolOperation {
            id: "inspect".into(),
            title: "检查".into(),
            description: String::new(),
            risk: PrivateToolRisk::ReadOnly,
            confirmation_text: String::new(),
            fields,
            arguments: vec!["script.py".into()],
            preview_arguments: None,
        };
        let manifest = |fields| PrivateToolsManifest {
            version: 1,
            tools: vec![PrivateToolDefinition {
                id: "validator".into(),
                title: "校验".into(),
                description: String::new(),
                icon: default_icon(),
                executable: "python".into(),
                working_directory: None,
                operations: vec![operation(fields)],
            }],
        };
        assert!(validate_manifest(&manifest(vec![select]))
            .unwrap_err()
            .contains("选项配置无效或重复"));
        assert!(validate_manifest(&manifest(vec![numeric]))
            .unwrap_err()
            .contains("最小值不能大于最大值"));
    }

    #[test]
    #[ignore = "only launched as a cancellable child process"]
    fn private_tool_cancellation_helper() {
        thread::sleep(Duration::from_secs(8));
        println!(r#"{{"ok":true}}"#);
    }

    #[test]
    fn cancellation_stops_the_spawned_process_promptly() {
        let executable = std::env::current_exe().expect("current test executable");
        let tool = PrivateToolDefinition {
            id: "cancellable".into(),
            title: "可取消工具".into(),
            description: String::new(),
            icon: default_icon(),
            executable: executable.to_string_lossy().into_owned(),
            working_directory: None,
            operations: vec![],
        };
        let state = PrivateToolRunState::default();
        let run_id = "cancel-test";
        state.begin(run_id).unwrap();
        let worker_state = state.clone();
        let started = Instant::now();
        let worker = thread::spawn(move || {
            execute(
                tool,
                vec![
                    "--exact".into(),
                    "private_tools::tests::private_tool_cancellation_helper".into(),
                    "--ignored".into(),
                    "--nocapture".into(),
                ],
                run_id,
                worker_state,
            )
        });
        thread::sleep(Duration::from_millis(180));
        state.cancel(run_id).unwrap();
        let error = match worker.join().unwrap() {
            Ok(_) => panic!("cancellable child process completed instead of stopping"),
            Err(error) => error,
        };
        state.finish(run_id);

        assert!(error.contains("任务已取消"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
