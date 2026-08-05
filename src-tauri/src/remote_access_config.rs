use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessConfig {
    version: u32,
    pub enabled: bool,
    /// Optional public HTTPS origin exposed through a tunnel (for example
    /// `https://www.zicode.com:39010`). When set, the desktop adds the host
    /// to the TLS certificate, advertises the URL to the phone, and starts a
    /// strictly authenticated public gateway listener for frp to forward.
    #[serde(default)]
    pub public_url: Option<String>,
    /// Optional public HTTP address of the certificate setup page (for
    /// example `http://www.zicode.com:39011`). New phones download the CA
    /// there when they are not on the same LAN.
    #[serde(default)]
    pub public_enrollment_url: Option<String>,
    /// Productized remote access: the desktop dials out to a rendezvous relay
    /// and the mobile reaches it through the same relay. The relay never
    /// stores content; the desktop remains the authentication authority.
    #[serde(default)]
    pub relay_enabled: bool,
    #[serde(default)]
    pub relay_url: Option<String>,
    #[serde(default)]
    pub relay_device_id: Option<String>,
    /// M4: shared secret for the rendezvous relay's desktop registration.
    /// Must match the server's `ZICODE_RELAY_REGISTRATION_TOKEN`. `None`
    /// keeps compatibility with open (development) relays.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_registration_token: Option<String>,
    /// M2: WebRTC ICE servers (STUN/TURN) handed to the phone so P2P can
    /// cross NAT. Opaque JSON array matching the browser `iceServers` shape;
    /// TURN credentials should be short-lived when derived from the coturn
    /// auth-secret. `None` (or `[]`) keeps host-only candidates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relay_ice_servers: Option<Vec<serde_json::Value>>,
}

impl Default for RemoteAccessConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            enabled: false,
            public_url: None,
            public_enrollment_url: None,
            relay_enabled: false,
            relay_url: None,
            relay_device_id: None,
            relay_registration_token: None,
            relay_ice_servers: None,
        }
    }
}

pub fn load() -> Result<RemoteAccessConfig, String> {
    load_at(&config_path()?)
}

pub fn set_enabled(enabled: bool) -> Result<RemoteAccessConfig, String> {
    let mut config = load()?;
    config.enabled = enabled;
    save_at(&config_path()?, &config)?;
    Ok(config)
}

/// Persist the optional public tunnel addresses. `None` (or an empty string)
/// clears the value. Invalid URLs are rejected so the settings UI cannot save
/// an origin the TLS certificate cannot cover.
pub fn update_public(
    public_url: Option<String>,
    public_enrollment_url: Option<String>,
) -> Result<RemoteAccessConfig, String> {
    let public_url = normalize_url(public_url)?;
    let public_enrollment_url = normalize_url(public_enrollment_url)?;
    let mut config = load()?;
    config.public_url = public_url;
    config.public_enrollment_url = public_enrollment_url;
    save_at(&config_path()?, &config)?;
    Ok(config)
}

/// Persist the relay (server rendezvous) settings. Enabling relay access
/// requires a relay URL; the device id is auto-generated on first enable.
pub fn update_relay(
    relay_enabled: bool,
    relay_url: Option<String>,
    relay_device_id: Option<String>,
) -> Result<RemoteAccessConfig, String> {
    let relay_url = normalize_ws_url(relay_url)?;
    let relay_device_id = relay_device_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if relay_enabled && relay_url.is_none() {
        return Err("relay_url is required when relay access is enabled".to_string());
    }
    let mut config = load()?;
    config.relay_enabled = relay_enabled;
    config.relay_url = relay_url;
    if relay_enabled {
        config.relay_device_id = Some(
            relay_device_id.unwrap_or_else(|| format!("dev-{}", uuid::Uuid::new_v4().simple())),
        );
    } else {
        config.relay_device_id = relay_device_id;
    }
    save_at(&config_path()?, &config)?;
    Ok(config)
}

fn normalize_url(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim().to_string();
    if value.is_empty() {
        return Ok(None);
    }
    if !value.starts_with("https://") && !value.starts_with("http://") {
        return Err("Public addresses must start with http:// or https://".to_string());
    }
    if value.contains(' ') || value.contains('#') {
        return Err("Public addresses must not contain spaces or fragments".to_string());
    }
    Ok(Some(value))
}

fn normalize_ws_url(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim().to_string();
    if value.is_empty() {
        return Ok(None);
    }
    if !value.starts_with("wss://") && !value.starts_with("ws://") {
        return Err("Relay URLs must start with ws:// or wss://".to_string());
    }
    if value.contains(' ') {
        return Err("Relay URLs must not contain spaces".to_string());
    }
    Ok(Some(value))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(crate::app_paths::data_root()?
        .join("remote-access")
        .join("config.json"))
}

fn load_at(path: &Path) -> Result<RemoteAccessConfig, String> {
    if !path.is_file() {
        return Ok(RemoteAccessConfig::default());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("Cannot read remote access settings: {error}"))?;
    let config: RemoteAccessConfig = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid remote access settings: {error}"))?;
    if config.version != CONFIG_VERSION {
        return Err(format!(
            "Unsupported remote access settings version {}",
            config.version
        ));
    }
    Ok(config)
}

fn save_at(path: &Path, config: &RemoteAccessConfig) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = parent.join(format!(
        ".remote-access-{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let bytes = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("Cannot encode remote access settings: {error}"))?;
    let write_result = (|| {
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("Cannot create temporary remote access settings: {error}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Cannot write remote access settings: {error}"))?;
        let backup = path.with_extension(format!("json.bak-{}", std::process::id()));
        let had_existing = path.is_file();
        if had_existing {
            fs::rename(path, &backup)
                .map_err(|error| format!("Cannot prepare remote access settings: {error}"))?;
        }
        if let Err(error) = fs::rename(&temporary, path) {
            if had_existing {
                let _ = fs::rename(&backup, path);
            }
            return Err(format!("Cannot replace remote access settings: {error}"));
        }
        if had_existing {
            let _ = fs::remove_file(backup);
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(test)]
mod tests {
    use super::{load_at, normalize_url, normalize_ws_url, save_at, RemoteAccessConfig};
    use std::fs;

    #[test]
    fn defaults_to_disabled_and_persists_an_explicit_choice() {
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-config-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("remote-access/config.json");
        assert!(!load_at(&path).unwrap().enabled);

        let enabled = RemoteAccessConfig {
            enabled: true,
            ..RemoteAccessConfig::default()
        };
        save_at(&path, &enabled).unwrap();
        assert_eq!(load_at(&path).unwrap(), enabled);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unknown_versions_instead_of_enabling_access() {
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-config-version-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("config.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(&path, r#"{"version":99,"enabled":true}"#).unwrap();
        assert!(load_at(&path)
            .unwrap_err()
            .contains("Unsupported remote access settings version"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn persists_optional_public_tunnel_addresses() {
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-config-public-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("remote-access/config.json");

        let with_public = RemoteAccessConfig {
            version: 1,
            enabled: true,
            public_url: Some("https://www.zicode.com:39010".into()),
            public_enrollment_url: Some("http://www.zicode.com:39011".into()),
            relay_enabled: false,
            relay_url: None,
            relay_device_id: None,
            relay_registration_token: None,
            relay_ice_servers: None,
        };
        save_at(&path, &with_public).unwrap();

        let loaded = load_at(&path).unwrap();
        assert_eq!(loaded, with_public);
        assert_eq!(
            loaded.public_url.as_deref(),
            Some("https://www.zicode.com:39010")
        );
        assert_eq!(
            loaded.public_enrollment_url.as_deref(),
            Some("http://www.zicode.com:39011")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn normalizes_optional_public_urls() {
        assert_eq!(normalize_url(None).unwrap(), None);
        assert_eq!(normalize_url(Some("   ".into())).unwrap(), None);
        assert_eq!(
            normalize_url(Some(" https://www.zicode.com:39010 ".into())).unwrap(),
            Some("https://www.zicode.com:39010".into())
        );
        assert!(normalize_url(Some("www.zicode.com".into())).is_err());
        assert!(normalize_url(Some("https://a b.com".into())).is_err());
        assert!(normalize_url(Some("https://x.com/#frag".into())).is_err());
    }

    #[test]
    fn serializes_relay_settings_and_validates_ws_urls() {
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-config-relay-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("remote-access/config.json");

        let with_relay = RemoteAccessConfig {
            version: 1,
            enabled: true,
            public_url: Some("https://relay.zicode.com/d/dev-1".into()),
            public_enrollment_url: None,
            relay_enabled: true,
            relay_url: Some("wss://relay.zicode.com/relay".into()),
            relay_device_id: Some("dev-1".into()),
            relay_registration_token: Some("s3cret".into()),
            relay_ice_servers: None,
        };
        save_at(&path, &with_relay).unwrap();
        assert_eq!(load_at(&path).unwrap(), with_relay);
        fs::remove_dir_all(root).unwrap();

        assert_eq!(
            normalize_ws_url(Some("ws://127.0.0.1:9900/relay".into())).unwrap(),
            Some("ws://127.0.0.1:9900/relay".into())
        );
        assert_eq!(normalize_ws_url(Some("".into())).unwrap(), None);
        assert!(normalize_ws_url(Some("https://x.com".into())).is_err());
        assert!(normalize_ws_url(Some("ws://a b".into())).is_err());
    }

    #[test]
    fn persists_the_relay_registration_token_but_omits_it_when_absent() {
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-config-reg-token-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("remote-access/config.json");

        let with_token = RemoteAccessConfig {
            relay_enabled: true,
            relay_registration_token: Some("s3cret".into()),
            ..RemoteAccessConfig::default()
        };
        save_at(&path, &with_token).unwrap();
        assert_eq!(load_at(&path).unwrap(), with_token);
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("relayRegistrationToken"));

        let without = RemoteAccessConfig::default();
        save_at(&path, &without).unwrap();
        assert_eq!(load_at(&path).unwrap(), without);
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("relayRegistrationToken"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn persists_relay_ice_servers_and_omits_them_when_absent() {
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-config-ice-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("remote-access/config.json");

        let with_ice = RemoteAccessConfig {
            relay_enabled: true,
            relay_ice_servers: Some(vec![
                serde_json::json!({ "urls": ["stun:turn.remote.zicode.com:3478"] }),
                serde_json::json!({
                    "urls": ["turn:turn.remote.zicode.com:3478?transport=udp"],
                    "username": "1750000000:dev-1",
                    "credential": "hmac-placeholder",
                }),
            ]),
            ..Default::default()
        };
        save_at(&path, &with_ice).unwrap();
        assert_eq!(load_at(&path).unwrap(), with_ice);

        let without = RemoteAccessConfig::default();
        save_at(&path, &without).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("relayIceServers"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
