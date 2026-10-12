// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tauri-plugin-reader",
    platforms: [.iOS(.v16)],
    products: [.library(name: "tauri-plugin-reader", type: .static, targets: ["tauri-plugin-reader"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "tauri-plugin-reader", dependencies: [.byName(name: "Tauri")], path: "Sources")]
)
