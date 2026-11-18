fn main() {
    // Test binaries (cargo test) link the dialog plugin, which imports
    // TaskDialogIndirect from Common Controls v6. The app gets its manifest from
    // tauri-build; test binaries need one too or Windows refuses to load them
    // (STATUS_ENTRYPOINT_NOT_FOUND).
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // An external `<exe>.manifest` is written next to each binary; the app's
        // own embedded manifest (tauri-build) takes precedence over it.
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
    }
    tauri_build::build()
}
