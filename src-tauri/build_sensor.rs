//! Compile the tiny .NET Framework reader into OUT_DIR; no SDK download or
//! duplicate vendor library. Non-Windows targets do not build this helper.
pub fn build(manifest: &std::path::Path) {
    println!("cargo:rerun-if-changed=sensors/SensorReader.cs");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let root = std::env::var_os("SystemRoot").expect("Windows system directory");
    let framework = std::path::PathBuf::from(root).join("Microsoft.NET/Framework64/v4.0.30319");
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output"))
        .join("zicode-hardware-sensor.exe");
    let mut command = std::process::Command::new(framework.join("csc.exe"));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    // The local toolchain may point TEMP at a shared directory with restrictive ACLs.
    // Keep this compiler's temporary files beside its own generated output.
    command
        .env("TEMP", output.parent().unwrap())
        .env("TMP", output.parent().unwrap());
    let status = command
        .args([
            "/nologo",
            "/optimize+",
            "/target:winexe",
            "/platform:anycpu",
        ])
        .arg("/reference:System.Web.Extensions.dll")
        .arg(format!("/out:{}", output.display()))
        .arg(manifest.join("sensors").join("SensorReader.cs"))
        .output()
        .expect("Compile CPU sensor reader with the Windows .NET Framework compiler");
    assert!(
        status.status.success(),
        "CPU sensor reader compilation failed: {:?}\n{}\n{}",
        status.status.code(),
        String::from_utf8_lossy(&status.stdout),
        String::from_utf8_lossy(&status.stderr)
    );
}
