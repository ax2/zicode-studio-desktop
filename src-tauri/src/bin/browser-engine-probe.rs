//! Development-only native acceptance runner; never opens the user's profile.
#[cfg(all(windows, debug_assertions))]
#[path = "../browser/probe_run.rs"]
mod probe_run;

#[cfg(all(windows, debug_assertions))]
fn main() {
    probe_run::main();
}

#[cfg(not(all(windows, debug_assertions)))]
fn main() {
    eprintln!("This acceptance runner requires a Windows debug build");
    std::process::exit(2);
}
