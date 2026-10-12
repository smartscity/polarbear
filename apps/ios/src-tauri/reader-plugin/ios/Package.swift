// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tauri-plugin-reader",
    platforms: [.macOS(.v11), .iOS(.v16)],
    products: [.library(name: "tauri-plugin-reader", type: .static, targets: ["tauri-plugin-reader"])],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
        .package(path: "../../../../../packages/apple-document-store"),
    ],
    targets: [.target(name: "tauri-plugin-reader", dependencies: [
        .byName(name: "Tauri"),
        .product(name: "PolarbearDocumentStore", package: "apple-document-store"),
    ], path: "Sources")]
)
