// Shared subprocess defaults also apply to the standalone acceptance runner.
#[cfg(all(windows, debug_assertions))]
#[allow(dead_code)]
#[path = "../process_command.rs"]
mod process_command;

#[cfg(all(windows, debug_assertions))]
#[path = "../visual_assets/probe.rs"]
mod probe;

fn main() {
    #[cfg(all(windows, debug_assertions))]
    if let Err(error) = probe::run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
    #[cfg(not(all(windows, debug_assertions)))]
    {
        eprintln!("Visual asset acceptance requires a Windows debug build");
        std::process::exit(2);
    }
}
