// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `Rhema --mcp`: an AI assistant started this copy as its MCP server (stdio, read-only). It must
    // not open a window or reach the running app (the single-instance plugin would hand it over).
    if std::env::args().any(|a| a == "--mcp") {
        rhema_lib::mcp::serve();
        return;
    }
    rhema_lib::run();
}
