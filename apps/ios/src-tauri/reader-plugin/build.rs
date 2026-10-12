fn main() {
    println!("cargo:rerun-if-changed=../../../../packages/apple-document-store");
    tauri_plugin::Builder::new(&[
        "importDocuments",
        "listDocuments",
        "readDocument",
        "readAsset",
        "removeCollection",
        "pending_open_documents",
        "acknowledge_open_document",
    ])
    .ios_path("ios")
    .build();
}
