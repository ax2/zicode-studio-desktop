//! A single, credential-free HTTP proxy endpoint. Keep command options internal.
use reqwest::Url;
use std::net::Ipv6Addr;

pub(super) const INVALID_PROXY: &str =
    "Enter one HTTP proxy address with a hostname or IP and port";
const BROWSER_ARGUMENTS: &str = "--disable-features=msWebOOUI,msPdfOOUI";

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(transparent)]
pub(crate) struct HttpProxy(String);

impl HttpProxy {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        let invalid = || INVALID_PROXY.to_owned();
        let authority = value.strip_prefix("http://").ok_or_else(invalid)?;
        let (host, port) = authority.rsplit_once(':').ok_or_else(invalid)?;
        if authority.len() > 259
            || port.is_empty()
            || port.len() > 5
            || !port.bytes().all(|byte| byte.is_ascii_digit())
        {
            return Err(invalid());
        }
        let port = port
            .parse::<u16>()
            .ok()
            .filter(|port| *port != 0)
            .ok_or_else(invalid)?;

        let host = if let Some(bracketed) = host
            .strip_prefix('[')
            .and_then(|host| host.strip_suffix(']'))
        {
            let address = bracketed.parse::<Ipv6Addr>().map_err(|_| invalid())?;
            format!("[{address}]")
        } else {
            if host.len() > 253
                || !host.split('.').all(|label| {
                    !label.is_empty()
                        && label.len() <= 63
                        && !label.starts_with('-')
                        && !label.ends_with('-')
                        && label
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                })
            {
                return Err(invalid());
            }
            let lower = host.to_ascii_lowercase();
            let url = Url::parse(&format!("http://{lower}")).map_err(|_| invalid())?;
            // The browser URL parser accepts shorthand, octal and hexadecimal IPv4.
            // Accept only the hostname or address the user actually supplied.
            if url.host_str() != Some(lower.as_str()) {
                return Err(invalid());
            }
            lower
        };
        Ok(Self(format!("http://{host}:{port}")))
    }

    #[allow(dead_code)] // The standalone Windows probe does not persist settings.
    pub(crate) fn address(&self) -> &str {
        &self.0
    }

    pub(super) fn browser_arguments(proxy: Option<&Self>) -> String {
        match proxy {
            Some(proxy) => format!("{BROWSER_ARGUMENTS} --proxy-server={}", proxy.0),
            None => BROWSER_ARGUMENTS.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_keeps_a_single_http_endpoint_and_preserves_default_flags() {
        assert_eq!(HttpProxy::browser_arguments(None), BROWSER_ARGUMENTS);
        for (input, expected) in [
            ("http://LocalHost:8080", "http://localhost:8080"),
            ("http://127.0.0.1:80", "http://127.0.0.1:80"),
            ("http://[0:0:0:0:0:0:0:1]:9050", "http://[::1]:9050"),
            (
                "http://proxy.example.org:65535",
                "http://proxy.example.org:65535",
            ),
        ] {
            let proxy = HttpProxy::parse(input).unwrap();
            assert_eq!(proxy.address(), expected);
            assert_eq!(
                HttpProxy::browser_arguments(Some(&proxy)),
                format!("{BROWSER_ARGUMENTS} --proxy-server={expected}")
            );
        }
    }

    #[test]
    fn proxy_rejects_credentials_and_extra_options() {
        for input in [
            "",
            "http://proxy.example.org",
            "https://proxy.example.org:80",
            "socks5://proxy.example.org:80",
            "http://user:password@proxy.example.org:80",
            "http://@proxy.example.org:80",
            "http://proxy.example.org:80/extra",
            "http://proxy.example.org:80?mode=proxy",
            "http://proxy.example.org:80#fragment",
            "http://proxy.example.org:80,direct://",
            "http://proxy.example.org:80;https=direct://",
            "http://proxy.example.org:80 --proxy-bypass-list=*",
            "http://proxy.example.org:80
",
            "http://proxy%20.example.org:80",
            "http://proxy..example.org:80",
            "http://proxy.example.org:0",
            "http://proxy.example.org:65536",
            "http://::1:8080",
            "http://127.1:8080",
            "http://0x7f000001:8080",
            "http://[fe80::1%25Ethernet]:8080",
        ] {
            assert!(HttpProxy::parse(input).is_err(), "{input}");
        }
    }
}
