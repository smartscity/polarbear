// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "PolarbearDocumentStore",
    platforms: [.macOS(.v11), .iOS(.v16)],
    products: [.library(name: "PolarbearDocumentStore", targets: ["PolarbearDocumentStore"])],
    targets: [
        .target(name: "PolarbearDocumentStore"),
        .testTarget(name: "PolarbearDocumentStoreTests", dependencies: ["PolarbearDocumentStore"]),
    ]
)
