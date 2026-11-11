use reqwest::Url;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Network navigation policy; no file, custom protocol or embedded credentials.
/// DNS rebinding and subresource coverage need separate engine-level acceptance.
#[derive(Clone, Default)]
pub struct BrowserPolicy {
    probe_origin: Option<String>,
}

impl BrowserPolicy {
    pub fn public_web() -> Self {
        Self::default()
    }

    #[cfg(debug_assertions)]
    #[cfg_attr(not(test), allow(dead_code))] // Only the standalone native acceptance runner grants loopback.
    pub fn isolated_probe(origin: &str) -> Result<Self, String> {
        let url = Url::parse(origin).map_err(|_| "Invalid probe origin")?;
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.port().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.path() != "/"
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("Probe accepts one numeric loopback HTTP origin only".into());
        }
        Ok(Self {
            probe_origin: Some(url.origin().ascii_serialization()),
        })
    }

    pub fn permits_download(&self, input: &str) -> bool {
        let source = input.strip_prefix("blob:").unwrap_or(input);
        matches!(Url::parse(source).ok().map(|v| v.scheme().to_owned()).as_deref(), Some("http" | "https")) && self.permits(source)
    }
    pub fn permits_resource(&self, input: &str) -> bool {
        if input.starts_with("blob:") { self.permits_download(input) } else { self.permits(input) }
    }
    pub fn permits(&self, input: &str) -> bool {
        if input == "about:blank" {
            return true;
        }
        let Ok(url) = Url::parse(input) else {
            return false;
        };
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return false;
        }
        if self.probe_origin.as_deref() == Some(&url.origin().ascii_serialization()) {
            return true;
        }
        let Some(host) = url.host_str() else {
            return false;
        };
        let host = host
            .trim_matches(['[', ']'])
            .trim_end_matches('.')
            .to_ascii_lowercase();
        match host.parse::<IpAddr>() {
            Ok(IpAddr::V4(ip)) => public_v4(ip),
            Ok(IpAddr::V6(ip)) => public_v6(ip),
            Err(_) => {
                host.contains('.')
                    && !["localhost", "local", "internal", "invalid", "test"]
                        .iter()
                        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
            }
        }
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !ip.is_private()
        && !ip.is_loopback()
        && !ip.is_link_local()
        && !ip.is_broadcast()
        && !ip.is_documentation()
        && a != 0
        && a < 224
        && !(a == 100 && (64..=127).contains(&b))
        && !(a == 198 && (b == 18 || b == 19))
        && !(a == 192 && b == 0 && c == 0)
}

fn public_v6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return public_v4(mapped);
    }
    let segments = ip.segments();
    // Global unicast only; reject documentation and transition addresses.
    (segments[0] & 0xe000) == 0x2000
        && !(segments[0] == 0x2001 && (segments[1] <= 0x1ff || segments[1] == 0xdb8))
        && segments[0] != 0x2002
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn permits_normal_public_web_and_blank() {
        let policy = BrowserPolicy::public_web();
        for url in [
            "about:blank",
            "https://example.com/",
            "https://1.1.1.1/",
            "https://[2606:4700:4700::1111]/",
        ] {
            assert!(policy.permits(url), "{url}");
        }
    }
    #[test]
    fn blocks_native_schemes_credentials_and_nonpublic_destinations() {
        let policy = BrowserPolicy::public_web();
        for url in [
            "file:///D:/secret",
            "javascript:alert(1)",
            "data:text/html,hi",
            "tauri://localhost",
            "ipc://localhost",
            "https://user:pass@example.com",
            "http://localhost:1234",
            "http://127.1",
            "http://2130706433",
            "http://0x7f000001",
            "http://[::ffff:127.0.0.1]",
            "http://[::1]",
            "http://[fc00::1]",
            "http://[fe80::1]",
            "http://[2002:7f00:1::]",
            "http://[2001:db8::1]",
            "http://10.0.0.1",
            "http://172.16.1.1",
            "http://192.168.0.1",
            "http://169.254.169.254",
            "http://100.64.0.1",
            "http://192.0.2.1",
            "http://router.local",
            "http://localhost.",
            "https://x.localhost/",
            "http://single-label/",
        ] {
            assert!(!policy.permits(url), "{url}");
        }
    }
    #[test]
    fn blob_downloads_require_public_http_origins_without_granting_navigation() {
        let policy = BrowserPolicy::public_web();
        assert!(policy.permits_download("blob:https://example.org/abc"));
        assert!(policy.permits_resource("blob:https://example.org/abc"));
        assert!(!policy.permits("blob:https://example.org/abc"));
        for url in ["blob:null/abc", "blob:http://127.0.0.1/abc", "blob:file:///secret", "about:blank", "data:text/plain,hi", "blob:https://user:pass@example.org/a"] {
            assert!(!policy.permits_download(url), "{url}");
        }
    }
    #[test]
    fn probe_grant_is_exact_and_never_grants_other_ports() {
        let policy = BrowserPolicy::isolated_probe("http://127.0.0.1:31234/").unwrap();
        assert!(policy.permits("http://127.0.0.1:31234/one"));
        assert!(!policy.permits("http://127.0.0.1:31235/"));
        assert!(!policy.permits("http://localhost:31234/"));
        assert!(!policy.permits("http://127.0.0.1:31234@evil.local/"));
        assert!(BrowserPolicy::isolated_probe("https://example.com/").is_err());
    }
}
