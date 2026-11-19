mod desktop_profile;
mod desktop_update_handoff;
mod process_command;
mod explorer_entry {
    pub fn file()->Option<()> { None }
    pub fn folder()->Option<()> { None }
    pub fn selection()->Option<()> { None }
}
fn main() -> Result<(),String> {
    let profile = std::path::PathBuf::from(std::env::var_os("Q32_PROFILE").unwrap());
    desktop_profile::initialize(std::env::args_os())?;
    assert_eq!(desktop_profile::root(),Some(profile.as_path()));
    assert!(!desktop_profile::requires_explicit_argument());
    assert!(desktop_profile::system_credentials_enabled());
    let updates = profile.join("data/desktop-updates");
    let candidate=std::path::PathBuf::from(std::env::var_os("Q32_CANDIDATE").unwrap());
    desktop_update_handoff::start(&candidate,"e6f18ac3d4de6dfab123755ff75cb3ca7cd6486ed4a11619c5269d8760abdb9c","0.6.2",&updates)?;
    println!("PASS production Rust profile resolved daily permission; independent helper ready, test parent exits normally");
    Ok(())
}
