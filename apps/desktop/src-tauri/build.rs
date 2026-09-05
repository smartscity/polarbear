use serde_json::Value;
use std::env;
use std::error::Error;
use std::fs;
use std::io;
use std::path::PathBuf;

fn invalid_contract(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn main() -> Result<(), Box<dyn Error>> {
    let contract_path = PathBuf::from("../contracts/memory/runtime-launch-v1.json");
    println!("cargo:rerun-if-changed={}", contract_path.display());
    let source = fs::read_to_string(&contract_path)?;
    let contract: Value = serde_json::from_str(&source)?;
    if contract.get("contract").and_then(Value::as_str) != Some("polarbear-memory-runtime-launch") {
        return Err(invalid_contract("unexpected runtime descriptor contract name").into());
    }
    let schema_version = contract
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| invalid_contract("runtime descriptor schemaVersion must be a u32"))?;
    let relative_path_values = contract
        .get("relativePath")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_contract("runtime descriptor relativePath must be an array"))?;
    let mut relative_path = Vec::with_capacity(relative_path_values.len());
    for value in relative_path_values {
        let part = value.as_str().ok_or_else(|| {
            invalid_contract("runtime descriptor path components must be strings")
        })?;
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.contains('/')
            || part.contains('\\')
        {
            return Err(invalid_contract(
                "runtime descriptor path components must be safe relative names",
            )
            .into());
        }
        relative_path.push(part);
    }
    if relative_path.is_empty() {
        return Err(invalid_contract("runtime descriptor relativePath must not be empty").into());
    }
    let runtime_field_values = contract
        .get("runtimeFields")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid_contract("runtime descriptor runtimeFields must be an array"))?;
    let runtime_fields = runtime_field_values
        .iter()
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| invalid_contract("runtime descriptor field names must be strings"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if runtime_fields != ["executable", "cliEntrypoint"] {
        return Err(invalid_contract("unexpected runtime descriptor field names").into());
    }
    let generated = format!(
        "pub const RUNTIME_DESCRIPTOR_SCHEMA_VERSION: u32 = {schema_version};\n\
         pub const RUNTIME_DESCRIPTOR_RELATIVE_PATH: &[&str] = &{relative_path:?};\n"
    );
    let output_directory = env::var_os("OUT_DIR")
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "OUT_DIR is required"))?;
    let output = PathBuf::from(output_directory).join("runtime_descriptor_contract.rs");
    fs::write(output, generated)?;
    tauri_build::build();
    Ok(())
}
