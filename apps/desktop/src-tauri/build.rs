use serde_json::Value;
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let contract_path = PathBuf::from("../contracts/memory/runtime-launch-v1.json");
    println!("cargo:rerun-if-changed={}", contract_path.display());
    let source = fs::read_to_string(&contract_path)
        .unwrap_or_else(|error| panic!("failed to read runtime descriptor contract: {error}"));
    let contract: Value = serde_json::from_str(&source)
        .unwrap_or_else(|error| panic!("failed to parse runtime descriptor contract: {error}"));
    assert_eq!(
        contract.get("contract").and_then(Value::as_str),
        Some("polarbear-memory-runtime-launch"),
        "unexpected runtime descriptor contract name"
    );
    let schema_version = contract
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .expect("runtime descriptor schemaVersion must be a u32");
    let relative_path: Vec<&str> = contract
        .get("relativePath")
        .and_then(Value::as_array)
        .expect("runtime descriptor relativePath must be an array")
        .iter()
        .map(|value| {
            let part = value
                .as_str()
                .expect("runtime descriptor path components must be strings");
            assert!(
                !part.is_empty()
                    && part != "."
                    && part != ".."
                    && !part.contains('/')
                    && !part.contains('\\'),
                "runtime descriptor path components must be safe relative names"
            );
            part
        })
        .collect();
    assert!(
        !relative_path.is_empty(),
        "runtime descriptor relativePath must not be empty"
    );
    let runtime_fields: Vec<&str> = contract
        .get("runtimeFields")
        .and_then(Value::as_array)
        .expect("runtime descriptor runtimeFields must be an array")
        .iter()
        .map(|value| {
            value
                .as_str()
                .expect("runtime descriptor field names must be strings")
        })
        .collect();
    assert_eq!(runtime_fields, ["executable", "cliEntrypoint"]);
    let generated = format!(
        "pub const RUNTIME_DESCRIPTOR_SCHEMA_VERSION: u32 = {schema_version};\n\
         pub const RUNTIME_DESCRIPTOR_RELATIVE_PATH: &[&str] = &{relative_path:?};\n"
    );
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is required"))
        .join("runtime_descriptor_contract.rs");
    fs::write(output, generated)
        .unwrap_or_else(|error| panic!("failed to generate runtime descriptor constants: {error}"));
    tauri_build::build();
}
