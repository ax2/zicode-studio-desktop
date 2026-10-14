//! Public web GET boundary shared by notes capture and page watching.
//! Check every hop before connecting. Direct connections pin DNS; existing built-in
//! features may use a configured proxy, whose own resolution cannot be pinned here.

use std::io::Read;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

const MAX_REDIRECTS: usize = 5;

pub(crate) struct Page {
    pub url: reqwest::Url,
    pub content_type: String,
    pub bytes: Vec<u8>,
}

pub(crate) fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let [a, b, c, _] = address.octets();
            !(address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
                || address.is_multicast()
                || address.is_broadcast()
                || a == 0
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || (a == 198 && (18..=19).contains(&b)))
        }
        IpAddr::V6(address) => {
            if let Some(embedded) = address.to_ipv4() {
                return is_public_ip(IpAddr::V4(embedded));
            }
            let first = address.segments()[0];
            !(address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80)
        }
    }
}

pub(crate) fn public_addresses(url: &reqwest::Url) -> Result<Vec<SocketAddr>, String> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only credential-free HTTP(S) URLs are allowed".into());
    }
    let host = url.host_str().ok_or("URL host is missing")?;
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("Loopback and private network URLs are not allowed".into());
    }
    let port = url.port_or_known_default().ok_or("URL port is invalid")?;
    let literal = host.trim_start_matches('[').trim_end_matches(']');
    let addresses: Vec<_> = if let Ok(address) = literal.parse::<IpAddr>() {
        vec![SocketAddr::new(address, port)]
    } else {
        (host, port)
            .to_socket_addrs()
            .map_err(|_| "Cannot resolve the web page host")?
            .collect()
    };
    if addresses.is_empty() || addresses.iter().any(|item| !is_public_ip(item.ip())) {
        return Err("Loopback and private network URLs are not allowed".into());
    }
    Ok(addresses)
}

pub(crate) fn validate_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw_url).map_err(|_| "Enter a valid HTTP(S) URL")?;
    public_addresses(&url)?;
    Ok(url)
}

pub(crate) fn get(
    raw_url: &str,
    max_bytes: usize,
    timeout: Duration,
    user_agent: &'static str,
    accept: Option<&'static str>,
    allow_configured_proxy: bool,
) -> Result<Page, String> {
    let mut url = reqwest::Url::parse(raw_url).map_err(|_| "Enter a valid HTTP(S) URL")?;
    for hop in 0..=MAX_REDIRECTS {
        let addresses = public_addresses(&url)?;
        let host = url.host_str().ok_or("URL host is missing")?;
        let mut builder = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(host, &addresses)
            .timeout(timeout)
            .user_agent(user_agent);
        // Only the existing built-in consumers opt into user-configured proxies.
        // A future plugin service must use the direct path until proxy target
        // identity and permission rules are part of its published contract.
        if !allow_configured_proxy {
            builder = builder.no_proxy();
        }
        let client = builder
            .build()
            .map_err(|_| "Cannot initialize public web client")?;
        let mut request = client.get(url.clone());
        if let Some(value) = accept {
            request = request.header(reqwest::header::ACCEPT, value);
        }
        let response = request.send().map_err(|_| "Cannot retrieve the web page")?;
        if response.status().is_redirection() {
            if hop == MAX_REDIRECTS {
                return Err("The web page redirected too many times".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("The web page returned an invalid redirect")?;
            url = url.join(location).map_err(|_| "Redirect URL is invalid")?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!(
                "The web page returned HTTP {}",
                response.status().as_u16()
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length > max_bytes as u64)
        {
            return Err("The web page exceeds the capture limit".into());
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mut bytes = Vec::new();
        response
            .take(max_bytes.saturating_add(1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "Web page download failed")?;
        if bytes.len() > max_bytes {
            return Err("The web page exceeds the capture limit".into());
        }
        return Ok(Page {
            url,
            content_type,
            bytes,
        });
    }
    Err("The web page could not be captured".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_private_and_embedded_private_addresses_without_network() {
        for address in ["127.0.0.1", "10.0.0.1", "::1", "::ffff:127.0.0.1"] {
            assert!(!is_public_ip(address.parse().unwrap()));
        }
        assert!(public_addresses(&reqwest::Url::parse("http://127.0.0.1/").unwrap()).is_err());
        assert!(
            public_addresses(&reqwest::Url::parse("https://user@example.com/").unwrap()).is_err()
        );
        assert!(public_addresses(&reqwest::Url::parse("file:///tmp/a").unwrap()).is_err());
        assert!(public_addresses(&reqwest::Url::parse("https://8.8.8.8/").unwrap()).is_ok());
    }
}
