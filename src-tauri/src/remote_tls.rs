#![cfg_attr(not(test), allow(dead_code))]

use rcgen::{
    BasicConstraints, CertificateParams, DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair,
    KeyUsagePurpose,
};
use sha2::{Digest, Sha256};
use std::fs;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener};
use std::path::{Path, PathBuf};

const CA_COMMON_NAME: &str = "ZiCode Studio Mobile CA";
const SERVER_COMMON_NAME: &str = "ZiCode Studio Desktop";
const KEYRING_SERVICE: &str = "ZiCode Studio Desktop";
const CA_KEYRING_ACCOUNT: &str = "remote-access-ca-key-v1";
const PREFERRED_LAN_PORT_BASE: u16 = 57_652;
const PREFERRED_LAN_PORT_COUNT: u16 = 16;
const PREFERRED_ENROLLMENT_PORT_BASE: u16 = 57_668;
const PREFERRED_ENROLLMENT_PORT_COUNT: u16 = 16;

#[derive(Debug, Clone)]
pub struct RemoteCaMaterial {
    pub certificate_pem: String,
    pub private_key_pem: String,
}

#[derive(Debug, Clone)]
pub struct RemoteTlsIdentity {
    pub certificate_chain_pem: Vec<u8>,
    pub private_key_pem: Vec<u8>,
    pub ca_certificate_pem: String,
    pub ca_fingerprint: String,
    pub lan_addresses: Vec<IpAddr>,
}

pub struct PreparedRemoteTlsListener {
    pub listener: TcpListener,
    pub enrollment_listener: TcpListener,
    pub tls_config: axum_server::tls_rustls::RustlsConfig,
    pub urls: Vec<String>,
    pub enrollment_urls: Vec<String>,
    pub ca_certificate_pem: String,
    pub ca_fingerprint: String,
}

pub async fn prepare_lan_listener() -> Result<PreparedRemoteTlsListener, String> {
    let addresses = discover_private_lan_addresses()?;
    let ca = load_or_create_ca()?;
    prepare_lan_listener_with_ca(ca, addresses).await
}

async fn prepare_lan_listener_with_ca(
    ca: RemoteCaMaterial,
    addresses: Vec<IpAddr>,
) -> Result<PreparedRemoteTlsListener, String> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let identity = issue_server_identity(&ca, addresses.iter().copied())?;
    let listener = bind_listener_range(PREFERRED_LAN_PORT_BASE, PREFERRED_LAN_PORT_COUNT)?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Cannot read the secure mobile listener address: {error}"))?
        .port();
    let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem(
        identity.certificate_chain_pem,
        identity.private_key_pem,
    )
    .await
    .map_err(|error| format!("Cannot configure secure mobile TLS: {error}"))?;
    let enrollment_listener = bind_listener_range(
        PREFERRED_ENROLLMENT_PORT_BASE,
        PREFERRED_ENROLLMENT_PORT_COUNT,
    )?;
    let enrollment_port = enrollment_listener
        .local_addr()
        .map_err(|error| format!("Cannot read the mobile setup listener address: {error}"))?
        .port();
    let advertised = advertisable_lan_addresses(&identity.lan_addresses);
    let urls = advertised
        .iter()
        .filter(|address| address.is_ipv4())
        .map(|address| format!("https://{address}:{port}"))
        .collect::<Vec<_>>();
    let enrollment_urls = advertised
        .iter()
        .filter(|address| address.is_ipv4())
        .map(|address| format!("http://{address}:{enrollment_port}"))
        .collect();
    Ok(PreparedRemoteTlsListener {
        listener,
        enrollment_listener,
        tls_config,
        urls,
        enrollment_urls,
        ca_certificate_pem: identity.ca_certificate_pem,
        ca_fingerprint: identity.ca_fingerprint,
    })
}

pub fn load_or_create_ca() -> Result<RemoteCaMaterial, String> {
    let certificate_path = ca_certificate_path()?;
    let certificate = match fs::read_to_string(&certificate_path) {
        Ok(value) => Some(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "Cannot read mobile CA certificate {}: {error}",
                certificate_path.display()
            ))
        }
    };
    let entry = keyring::Entry::new(KEYRING_SERVICE, CA_KEYRING_ACCOUNT)
        .map_err(|error| format!("Cannot open the system credential vault: {error}"))?;
    let private_key = match entry.get_password() {
        Ok(value) => Some(value),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => return Err(format!("Cannot read the mobile CA key: {error}")),
    };

    match reconcile_ca_material(certificate, private_key)? {
        Some(material) => {
            validate_ca_material(&material)?;
            Ok(material)
        }
        None => {
            let material = generate_ca()?;
            entry
                .set_password(&material.private_key_pem)
                .map_err(|error| format!("Cannot store the mobile CA key: {error}"))?;
            if let Err(error) = write_text_atomic(&certificate_path, &material.certificate_pem) {
                let _ = entry.delete_credential();
                return Err(error);
            }
            Ok(material)
        }
    }
}

pub fn ca_certificate_path() -> Result<PathBuf, String> {
    Ok(crate::app_paths::data_root()?
        .join("remote-access")
        .join("ca.pem"))
}

pub fn generate_ca() -> Result<RemoteCaMaterial, String> {
    let mut params = CertificateParams::new(Vec::<String>::new())
        .map_err(|error| format!("Cannot create mobile CA parameters: {error}"))?;
    params
        .distinguished_name
        .push(DnType::CommonName, CA_COMMON_NAME);
    params
        .distinguished_name
        .push(DnType::OrganizationName, "ZiCode Studio Desktop");
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.key_usages = vec![
        KeyUsagePurpose::DigitalSignature,
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
    ];
    let key =
        KeyPair::generate().map_err(|error| format!("Cannot generate mobile CA key: {error}"))?;
    let certificate = params
        .self_signed(&key)
        .map_err(|error| format!("Cannot sign mobile CA certificate: {error}"))?;
    Ok(RemoteCaMaterial {
        certificate_pem: certificate.pem(),
        private_key_pem: key.serialize_pem(),
    })
}

pub fn issue_server_identity(
    ca: &RemoteCaMaterial,
    addresses: impl IntoIterator<Item = IpAddr>,
) -> Result<RemoteTlsIdentity, String> {
    let lan_addresses = private_lan_addresses(addresses);
    if lan_addresses.is_empty() {
        return Err("No private LAN address is available for secure mobile access".to_string());
    }
    let mut subject_alt_names = vec![
        "zicode.local".to_string(),
        "localhost".to_string(),
        "127.0.0.1".to_string(),
    ];
    subject_alt_names.extend(lan_addresses.iter().map(ToString::to_string));
    let mut params = CertificateParams::new(subject_alt_names)
        .map_err(|error| format!("Cannot create mobile TLS parameters: {error}"))?;
    params
        .distinguished_name
        .push(DnType::CommonName, SERVER_COMMON_NAME);
    params
        .distinguished_name
        .push(DnType::OrganizationName, "ZiCode Studio Desktop");
    params.use_authority_key_identifier_extension = true;
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];

    let ca_key = KeyPair::from_pem(&ca.private_key_pem)
        .map_err(|error| format!("Cannot read mobile CA key: {error}"))?;
    let issuer = Issuer::from_ca_cert_pem(&ca.certificate_pem, ca_key)
        .map_err(|error| format!("Cannot read mobile CA certificate: {error}"))?;
    let server_key =
        KeyPair::generate().map_err(|error| format!("Cannot generate mobile TLS key: {error}"))?;
    let certificate = params
        .signed_by(&server_key, &issuer)
        .map_err(|error| format!("Cannot sign mobile TLS certificate: {error}"))?;
    let certificate_chain_pem = format!("{}{}", certificate.pem(), ca.certificate_pem).into_bytes();
    Ok(RemoteTlsIdentity {
        certificate_chain_pem,
        private_key_pem: server_key.serialize_pem().into_bytes(),
        ca_certificate_pem: ca.certificate_pem.clone(),
        ca_fingerprint: certificate_fingerprint(&ca.certificate_pem)?,
        lan_addresses,
    })
}

pub fn private_lan_addresses(addresses: impl IntoIterator<Item = IpAddr>) -> Vec<IpAddr> {
    let mut candidates = addresses
        .into_iter()
        .filter(|address| match address {
            IpAddr::V4(address) => address.is_private() || address.is_link_local(),
            IpAddr::V6(address) => address.is_unique_local() || address.is_unicast_link_local(),
        })
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.dedup();
    // Prefer routable private addresses over APIPA/link-local ones: a plain
    // numeric sort would advertise 169.254.x.x before the real LAN IP, so the
    // phone could never reach the advertised URL. Link-local stays as a
    // last-resort fallback when no private address exists.
    let (mut lan, mut link_local): (Vec<_>, Vec<_>) =
        candidates.into_iter().partition(|address| match address {
            IpAddr::V4(address) => !address.is_link_local(),
            IpAddr::V6(address) => !address.is_unicast_link_local(),
        });
    lan.append(&mut link_local);
    lan
}

pub fn discover_private_lan_addresses() -> Result<Vec<IpAddr>, String> {
    let interfaces = local_ip_address::list_afinet_netifas()
        .map_err(|error| format!("Cannot inspect local network interfaces: {error}"))?;
    let mut addresses = private_lan_addresses(interfaces.into_iter().map(|(_, address)| address));
    // When several private adapters exist (Ethernet + Wi-Fi, VPN, WSL...), put
    // the interface the OS uses for the default route first so the advertised
    // LAN URL is actually reachable from the phone.
    if let Ok(primary) = local_ip_address::local_ip() {
        if let Some(index) = addresses.iter().position(|address| *address == primary) {
            let primary = addresses.remove(index);
            addresses.insert(0, primary);
        }
    }
    Ok(addresses)
}

/// Addresses suitable for advertising to the phone. APIPA/link-local addresses
/// are never reachable from a phone, so they are dropped whenever at least one
/// routable private address exists; otherwise they remain as a last resort.
pub fn advertisable_lan_addresses(addresses: &[IpAddr]) -> Vec<IpAddr> {
    let routable = addresses
        .iter()
        .filter(|address| match address {
            IpAddr::V4(address) => !address.is_link_local(),
            IpAddr::V6(address) => !address.is_unicast_link_local(),
        })
        .copied()
        .collect::<Vec<_>>();
    if routable.is_empty() {
        addresses.to_vec()
    } else {
        routable
    }
}

pub fn certificate_fingerprint(certificate_pem: &str) -> Result<String, String> {
    let certificate = pem::parse(certificate_pem)
        .map_err(|error| format!("Cannot parse mobile CA certificate: {error}"))?;
    let digest = Sha256::digest(certificate.contents());
    Ok(digest
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(":"))
}

fn reconcile_ca_material(
    certificate_pem: Option<String>,
    private_key_pem: Option<String>,
) -> Result<Option<RemoteCaMaterial>, String> {
    match (certificate_pem, private_key_pem) {
        (None, None) => Ok(None),
        (Some(certificate_pem), Some(private_key_pem)) => Ok(Some(RemoteCaMaterial {
            certificate_pem,
            private_key_pem,
        })),
        (Some(_), None) => Err(
            "The mobile CA certificate exists, but its system-vault key is missing. Remote access remains disabled."
                .to_string(),
        ),
        (None, Some(_)) => Err(
            "The mobile CA key exists, but its public certificate is missing. Remote access remains disabled."
                .to_string(),
        ),
    }
}

fn validate_ca_material(material: &RemoteCaMaterial) -> Result<(), String> {
    let key = KeyPair::from_pem(&material.private_key_pem)
        .map_err(|error| format!("Cannot read the mobile CA key: {error}"))?;
    Issuer::from_ca_cert_pem(&material.certificate_pem, key)
        .map_err(|error| format!("Cannot read the mobile CA certificate: {error}"))?;
    certificate_fingerprint(&material.certificate_pem)?;
    Ok(())
}

fn write_text_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = path.with_extension(format!("pem.tmp-{}", std::process::id()));
    fs::write(&temporary, contents)
        .map_err(|error| format!("Cannot write {}: {error}", temporary.display()))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Cannot replace {}: {error}", path.display()))
}

fn bind_listener_range(port_base: u16, port_count: u16) -> Result<TcpListener, String> {
    for offset in 0..port_count {
        let address = SocketAddr::from((Ipv4Addr::UNSPECIFIED, port_base + offset));
        if let Ok(listener) = TcpListener::bind(address) {
            listener
                .set_nonblocking(true)
                .map_err(|error| format!("Cannot configure secure mobile listener: {error}"))?;
            return Ok(listener);
        }
    }
    Err(format!(
        "Cannot bind secure mobile access on ports {}-{}",
        port_base,
        port_base + port_count - 1
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        advertisable_lan_addresses, certificate_fingerprint, generate_ca, issue_server_identity,
        prepare_lan_listener_with_ca, private_lan_addresses, reconcile_ca_material,
        validate_ca_material, write_text_atomic,
    };
    use std::fs;
    use std::net::IpAddr;

    #[test]
    fn issues_a_server_chain_only_for_private_lan_addresses() {
        let ca = generate_ca().unwrap();
        let identity = issue_server_identity(
            &ca,
            [
                "192.168.1.20".parse().unwrap(),
                "10.0.0.5".parse().unwrap(),
                "8.8.8.8".parse().unwrap(),
                "127.0.0.1".parse().unwrap(),
            ],
        )
        .unwrap();

        assert_eq!(
            identity.lan_addresses,
            vec![
                "10.0.0.5".parse::<IpAddr>().unwrap(),
                "192.168.1.20".parse::<IpAddr>().unwrap()
            ]
        );
        assert!(
            String::from_utf8(identity.certificate_chain_pem)
                .unwrap()
                .matches("BEGIN CERTIFICATE")
                .count()
                >= 2
        );
        assert!(String::from_utf8(identity.private_key_pem)
            .unwrap()
            .contains("BEGIN PRIVATE KEY"));
    }

    #[test]
    fn keeps_the_ca_fingerprint_stable_across_server_certificate_rotation() {
        let ca = generate_ca().unwrap();
        let first = issue_server_identity(&ca, ["192.168.1.20".parse().unwrap()]).unwrap();
        let second = issue_server_identity(&ca, ["192.168.1.21".parse().unwrap()]).unwrap();

        assert_eq!(first.ca_fingerprint, second.ca_fingerprint);
        assert_eq!(
            first.ca_fingerprint,
            certificate_fingerprint(&ca.certificate_pem).unwrap()
        );
        assert_eq!(first.ca_fingerprint.split(':').count(), 32);
    }

    #[test]
    fn rejects_public_loopback_and_unspecified_addresses() {
        assert!(private_lan_addresses([
            "8.8.8.8".parse().unwrap(),
            "127.0.0.1".parse().unwrap(),
            "0.0.0.0".parse().unwrap(),
            "::1".parse().unwrap(),
        ])
        .is_empty());
    }

    #[test]
    fn prefers_routable_private_addresses_over_link_local_for_advertising() {
        let addresses = private_lan_addresses([
            "169.254.2.255".parse::<IpAddr>().unwrap(),
            "192.168.5.80".parse::<IpAddr>().unwrap(),
            "fe80::1".parse::<IpAddr>().unwrap(),
            "10.0.0.5".parse::<IpAddr>().unwrap(),
        ]);
        assert_eq!(
            addresses,
            vec![
                "10.0.0.5".parse::<IpAddr>().unwrap(),
                "192.168.5.80".parse::<IpAddr>().unwrap(),
                "169.254.2.255".parse::<IpAddr>().unwrap(),
                "fe80::1".parse::<IpAddr>().unwrap(),
            ]
        );
    }

    #[test]
    fn keeps_link_local_addresses_as_a_fallback_only() {
        let addresses = private_lan_addresses(["169.254.2.255".parse::<IpAddr>().unwrap()]);
        assert_eq!(addresses, vec!["169.254.2.255".parse::<IpAddr>().unwrap()]);
    }

    #[test]
    fn drops_link_local_addresses_from_the_advertised_list_when_private_ones_exist() {
        let addresses = advertisable_lan_addresses(&[
            "172.16.8.185".parse::<IpAddr>().unwrap(),
            "169.254.2.255".parse::<IpAddr>().unwrap(),
            "192.168.3.171".parse::<IpAddr>().unwrap(),
            "fe80::1".parse::<IpAddr>().unwrap(),
        ]);
        assert_eq!(
            addresses,
            vec![
                "172.16.8.185".parse::<IpAddr>().unwrap(),
                "192.168.3.171".parse::<IpAddr>().unwrap(),
            ]
        );
    }

    #[test]
    fn keeps_link_local_addresses_when_no_private_address_is_available() {
        let addresses = advertisable_lan_addresses(&[
            "169.254.2.255".parse::<IpAddr>().unwrap(),
            "fe80::1".parse::<IpAddr>().unwrap(),
        ]);
        assert_eq!(addresses.len(), 2);
    }

    #[test]
    fn fails_closed_when_only_half_of_the_ca_material_remains() {
        assert!(reconcile_ca_material(Some("certificate".into()), None)
            .unwrap_err()
            .contains("key is missing"));
        assert!(reconcile_ca_material(None, Some("private key".into()))
            .unwrap_err()
            .contains("certificate is missing"));
        assert!(reconcile_ca_material(None, None).unwrap().is_none());
    }

    #[test]
    fn validates_a_complete_ca_and_atomically_persists_its_public_certificate() {
        let ca = generate_ca().unwrap();
        validate_ca_material(&ca).unwrap();
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-ca-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("remote-access/ca.pem");
        write_text_atomic(&path, &ca.certificate_pem).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), ca.certificate_pem);
        assert!(!path.with_extension("pem.tmp").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn serves_https_with_a_chain_trusted_by_the_generated_ca() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let ca = generate_ca().unwrap();
        let prepared =
            prepare_lan_listener_with_ca(ca.clone(), vec!["192.168.1.20".parse().unwrap()])
                .await
                .unwrap();
        let port = prepared.listener.local_addr().unwrap().port();
        let listener = tokio::net::TcpListener::from_std(prepared.listener).unwrap();
        let acceptor = tokio_rustls::TlsAcceptor::from(prepared.tls_config.get_inner());
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = acceptor.accept(stream).await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok")
                .await
                .unwrap();
        });

        let root = reqwest::Certificate::from_pem(ca.certificate_pem.as_bytes()).unwrap();
        let client = reqwest::Client::builder()
            .use_rustls_tls()
            .no_proxy()
            .http1_only()
            .add_root_certificate(root)
            .build()
            .unwrap();
        let response = client
            .get(format!("https://127.0.0.1:{port}/health"))
            .send()
            .await;
        if let Err(error) = response {
            let server_result = task.await;
            panic!("client failed: {error:?}; server result: {server_result:?}");
        }
        let response = response.unwrap();
        assert_eq!(response.text().await.unwrap(), "ok");
        task.await.unwrap();
    }
}
