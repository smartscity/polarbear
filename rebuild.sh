cd /Users/liyunlong/Documents/Smartscity

cargo clean -p polarbear-desktop

cargo build --workspace
npm run build
npm --workspace apps/desktop run tauri -- dev