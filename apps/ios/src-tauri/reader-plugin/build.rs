fn main() {
    tauri_plugin::Builder::new(&[
        "importDocuments",
        "listDocuments",
        "readDocument",
        "readAsset",
        "removeCollection",
    ])
    .ios_path("ios")
    .build();
}
