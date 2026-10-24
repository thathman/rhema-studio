//! Rhema Companion talks to its host over https with the host's certificate pinned (#209), as a
//! Rhema Receiver TV pins the certificate it is sent (#198). What is pinned is the host's local
//! certificate authority, made once per host computer (`tls/rhema-ca.pem` in its data folder): the
//! host's own https certificate is made again when its address changes, its CA is not. At pairing
//! the companion reads the CA the host presents, checks that the host's certificate is signed by
//! it, and shows its fingerprint, the same one the host shows in Settings → Remote control. From
//! then on it accepts only a certificate signed by that CA, whatever the address on it.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::server::ParsedCertificate;
use rustls::{DigitallySignedStruct, RootCertStore, SignatureScheme};
use sha2::{Digest, Sha256};

use crate::host::{base_url, Host};

/// What the operator is told when the host shows a certificate this computer did not pair with.
pub const NOT_THE_PAIRED_HOST: &str = "The host's certificate is not the one this computer paired with, so nothing was sent: pair again if the host computer was reinstalled (Leave this host, then join with a new code). Otherwise another computer may be pretending to be the host.";
/// What the operator is told when the host does not have its secure page on.
pub const NO_SECURE_PAGE: &str = "The host's secure page is off. On the host: Settings → Remote control → turn on \"Secure page for phones (https)\", then stop and start the listener. Rhema Companion talks to the host only over its secure page.";
/// Marks a refusal by this module in an error chain.
const REFUSED: &str = "rhema-companion: not the pinned certificate";

/// SHA-256 of a certificate's DER, lowercase hex (the host's `rhema_api::tls::fingerprint`).
pub fn fingerprint(der: &[u8]) -> String {
    use std::fmt::Write;
    Sha256::digest(der).iter().fold(String::with_capacity(64), |mut hex, b| {
        let _ = write!(hex, "{b:02x}");
        hex
    })
}

/// A fingerprint as it is kept: 64 lowercase hex characters.
pub fn valid_fingerprint(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The https port beside a host's http port: Rhema starts its secure page on the next port.
pub fn tls_port_of(address: &str) -> Result<u16, String> {
    let base = base_url(address)?;
    let port: u16 = base.rsplit_once(':').and_then(|(_, p)| p.parse().ok()).ok_or("no port")?;
    port.checked_add(1).ok_or_else(|| "That port has no secure page beside it".into())
}

/// Accepts the host's certificate when it is signed by the pinned CA (or, at pairing, by the CA the
/// host presents with it), in date and for a server. Names are not checked: the CA is this one
/// host's own, and the host makes a new certificate when its address changes.
#[derive(Debug)]
struct Pinned {
    pin: Option<String>,
    /// The CA the last accepted certificate was signed by (its fingerprint).
    seen: Mutex<Option<String>>,
    algs: WebPkiSupportedAlgorithms,
}

fn refused() -> rustls::Error {
    rustls::Error::General(REFUSED.into())
}

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(&self, leaf: &CertificateDer<'_>, intermediates: &[CertificateDer<'_>], _name: &ServerName<'_>, _ocsp: &[u8], now: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
        // The host sends its certificate with its CA after it.
        let ca = match &self.pin {
            Some(pin) => intermediates.iter().find(|c| fingerprint(c) == *pin),
            None => intermediates.last(),
        }
        .ok_or_else(refused)?;
        let mut roots = RootCertStore::empty();
        roots.add(ca.clone()).map_err(|_| refused())?;
        let parsed = ParsedCertificate::try_from(leaf).map_err(|_| refused())?;
        rustls::client::verify_server_cert_signed_by_trust_anchor(&parsed, &roots, &[], now, self.algs.all).map_err(|_| refused())?;
        if let Ok(mut seen) = self.seen.lock() {
            *seen = Some(fingerprint(ca));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.algs)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.algs)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algs.supported_schemes()
    }
}

fn tls(verifier: Arc<Pinned>) -> Result<rustls::ClientConfig, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    Ok(rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth())
}

fn verifier(pin: Option<String>) -> Arc<Pinned> {
    Arc::new(Pinned { pin, seen: Mutex::new(None), algs: rustls::crypto::ring::default_provider().signature_verification_algorithms })
}

/// The host at `address` over https on `tls_port`, accepting only a certificate signed by the CA
/// with this fingerprint.
pub fn pinned_host(address: &str, tls_port: u16, ca_fingerprint: &str) -> Result<Host, String> {
    if !valid_fingerprint(ca_fingerprint) {
        return Err("This computer's record of the host's certificate is damaged: pair again".into());
    }
    Host::https(address, tls_port, tls(verifier(Some(ca_fingerprint.to_string())))?)
}

/// The host's certificate authority as it presents it on `tls_port` (its fingerprint), checked to
/// have signed the host's certificate: what the companion shows at pairing and then pins.
pub async fn read_host_ca(address: &str, tls_port: u16) -> Result<String, String> {
    let v = verifier(None);
    let host = Host::https(address, tls_port, tls(v.clone())?)?;
    let tried = host.client(Some(Duration::from_secs(6)))?.get(host.url("/api/v1/health")).send().await;
    match tried {
        Ok(_) => v.seen.lock().ok().and_then(|s| s.clone()).ok_or_else(|| "The host's certificate could not be read".into()),
        Err(e) if refused_certificate(&e) => Err("The host's secure page shows a certificate that is not Rhema's: check the address".into()),
        Err(_) => {
            // No secure page there: say whether the host itself answers.
            let plain = Host::plain(address)?;
            match plain.client(Some(Duration::from_secs(5)))?.get(plain.url("/api/v1/health")).send().await {
                Ok(r) if r.status().is_success() => Err(NO_SECURE_PAGE.into()),
                _ => Err(format!("Could not reach the host at {}: is Rhema open there, with Remote control on the network, on the same network as this computer?", address.trim())),
            }
        }
    }
}

/// Whether a request failed because the host's certificate was refused here.
pub fn refused_certificate(e: &reqwest::Error) -> bool {
    let mut cause: Option<&(dyn std::error::Error + 'static)> = Some(e);
    while let Some(c) = cause {
        if c.to_string().contains(REFUSED) {
            return true;
        }
        cause = c.source();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use rhema_api::tls::{make_ca, make_server, server_config, Pem};
    use rustls::pki_types::pem::PemObject;

    /// A pretend host's secure page on 127.0.0.1 with this certificate (and its CA after it):
    /// answers every request with `{"status":"ok"}`. Returns its address as "127.0.0.1:<port>".
    async fn secure_host(server: &Pem, ca: &Pem) -> (String, u16) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let acceptor = tokio_rustls::TlsAcceptor::from(server_config(server, &ca.cert).unwrap());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    let Ok(mut tls) = acceptor.accept(tcp).await else { return };
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    while !String::from_utf8_lossy(&buf).contains("\r\n\r\n") {
                        let n = tls.read(&mut chunk).await.unwrap_or(0);
                        if n == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..n]);
                    }
                    let body = r#"{"status":"ok"}"#;
                    let _ = tls.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
                    let _ = tls.shutdown().await;
                });
            }
        });
        // The http address does not matter here: the https port is given.
        ("127.0.0.1:1".to_string(), port)
    }

    fn ca_fingerprint(ca: &Pem) -> String {
        fingerprint(CertificateDer::pem_slice_iter(ca.cert.as_bytes()).next().unwrap().unwrap().as_ref())
    }

    async fn health(host: &Host) -> Result<u16, String> {
        let r = host.client(Some(Duration::from_secs(5)))?.get(host.url("/api/v1/health")).send().await.map_err(|e| host.unreachable(&e))?;
        Ok(r.status().as_u16())
    }

    #[tokio::test]
    async fn pairing_reads_the_hosts_ca_and_only_that_ca_is_accepted_afterwards() {
        let ca = make_ca().unwrap();
        let (address, port) = secure_host(&make_server(&ca, &["192.168.1.20".into()]).unwrap(), &ca).await;
        // The same fingerprint the host shows (rhema_api::tls::fingerprint of its CA).
        let seen = read_host_ca(&address, port).await.unwrap();
        assert_eq!(seen, ca_fingerprint(&ca));
        assert_eq!(seen, rhema_api::tls::fingerprint(&ca).unwrap());
        assert!(valid_fingerprint(&seen));
        // Pinned: the host is reached, although its certificate names another address.
        assert_eq!(health(&pinned_host(&address, port, &seen).unwrap()).await, Ok(200));
        // The host's certificate made again (a new address), same CA: still accepted.
        let (address2, port2) = secure_host(&make_server(&ca, &["10.0.0.5".into()]).unwrap(), &ca).await;
        assert_eq!(health(&pinned_host(&address2, port2, &seen).unwrap()).await, Ok(200));
    }

    #[tokio::test]
    async fn another_computer_with_its_own_certificate_is_refused_and_told_plainly() {
        let ca = make_ca().unwrap();
        let pin = ca_fingerprint(&ca);
        let other = make_ca().unwrap();
        let (address, port) = secure_host(&make_server(&other, &["127.0.0.1".into()]).unwrap(), &other).await;
        assert_eq!(health(&pinned_host(&address, port, &pin).unwrap()).await, Err(NOT_THE_PAIRED_HOST.to_string()));
        // It presents the real host's CA beside a certificate that CA did not sign: refused too.
        let (address, port) = secure_host(&make_server(&other, &["127.0.0.1".into()]).unwrap(), &ca).await;
        assert_eq!(health(&pinned_host(&address, port, &pin).unwrap()).await, Err(NOT_THE_PAIRED_HOST.to_string()));
        // And at pairing, a certificate its "CA" did not sign is not Rhema's.
        assert!(read_host_ca(&address, port).await.unwrap_err().contains("not Rhema's"));
    }

    #[tokio::test]
    async fn no_secure_page_or_no_host_is_said_plainly() {
        let address = crate::host::tests::pretend_host(|_| (200, r#"{"status":"ok","service":"rhema"}"#.into())).await;
        // Nothing listens on the port after it (taken and let go again).
        let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert_eq!(read_host_ca(&address, closed).await.unwrap_err(), NO_SECURE_PAGE);
        assert!(read_host_ca(&format!("127.0.0.1:{closed}"), closed).await.unwrap_err().starts_with("Could not reach the host at 127.0.0.1:"));
    }

    #[test]
    fn the_secure_page_is_on_the_next_port_and_a_damaged_pin_is_refused() {
        assert_eq!(tls_port_of("192.168.1.20:8080"), Ok(8081));
        assert!(tls_port_of("192.168.1.20:65535").is_err());
        assert!(tls_port_of("nonsense").is_err());
        assert!(pinned_host("192.168.1.20:8080", 8081, "abc").is_err());
        assert!(pinned_host("192.168.1.20:8080", 8081, &"A".repeat(64)).is_err(), "kept lowercase");
        assert!(pinned_host("192.168.1.20:8080", 8081, &"a".repeat(64)).is_ok());
    }
}
