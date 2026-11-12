//! Opt-in https for the LAN listener (Rhema Comms, #251): a phone browser gives its microphone only
//! to a secure page. Rhema makes a local certificate authority once (kept in the app's data folder)
//! and, at each start, a certificate for this computer's current addresses signed by it. A phone
//! either accepts the browser's one-time warning or installs the CA (served at `/rhema-ca.pem`) to
//! trust it. Nothing leaves the church network; no outside service is involved.

use rcgen::{BasicConstraints, CertificateParams, CidrSubnet, DistinguishedName, DnType, ExtendedKeyUsagePurpose, GeneralSubtree, IsCa, KeyPair, KeyUsagePurpose, NameConstraints, SanType};

/// PEM text for one certificate and its private key.
#[derive(Debug, Clone)]
pub struct Pem {
    pub cert: String,
    pub key: String,
}

fn ca_params() -> CertificateParams {
    let mut p = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, "Rhema Studio local certificate authority");
    dn.push(DnType::OrganizationName, "Rhema Studio (this church's computer)");
    p.distinguished_name = dn;
    p.is_ca = IsCa::Ca(BasicConstraints::Constrained(0));
    // A phone that installs this CA trusts it only for private network addresses and this
    // computer's own names: even a stolen CA key cannot vouch for a public website.
    p.name_constraints = Some(NameConstraints {
        permitted_subtrees: vec![
            GeneralSubtree::IpAddress(CidrSubnet::V4([10, 0, 0, 0], [255, 0, 0, 0])),
            GeneralSubtree::IpAddress(CidrSubnet::V4([172, 16, 0, 0], [255, 240, 0, 0])),
            GeneralSubtree::IpAddress(CidrSubnet::V4([192, 168, 0, 0], [255, 255, 0, 0])),
            GeneralSubtree::IpAddress(CidrSubnet::V4([169, 254, 0, 0], [255, 255, 0, 0])),
            GeneralSubtree::IpAddress(CidrSubnet::V4([127, 0, 0, 0], [255, 0, 0, 0])),
            GeneralSubtree::IpAddress(CidrSubnet::V6([0xfc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0xfe, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
            GeneralSubtree::IpAddress(CidrSubnet::V6([0xfe, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0xff, 0xc0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])),
            GeneralSubtree::IpAddress(CidrSubnet::V6([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], [0xff; 16])),
            GeneralSubtree::DnsName("localhost".into()),
            GeneralSubtree::DnsName("local".into()),
        ],
        excluded_subtrees: vec![],
    });
    p.key_usages = vec![KeyUsagePurpose::KeyCertSign, KeyUsagePurpose::CrlSign, KeyUsagePurpose::DigitalSignature];
    p.not_before = rcgen::date_time_ymd(2026, 1, 1);
    p.not_after = rcgen::date_time_ymd(2036, 1, 1);
    p
}

/// A new local CA (once per computer; keep the key private).
pub fn make_ca() -> Result<Pem, String> {
    let key = KeyPair::generate().map_err(|e| e.to_string())?;
    let cert = ca_params().self_signed(&key).map_err(|e| e.to_string())?;
    Ok(Pem { cert: cert.pem(), key: key.serialize_pem() })
}

/// A new server key pair (PEM, private). Rhema makes it once and signs every server certificate over
/// it for the life of the local CA (doc 48), so a Receiver or Rhema Cam that pins its public key
/// still opens Rhema after the address changes or the certificate is renewed.
pub fn make_server_key() -> Result<String, String> {
    Ok(KeyPair::generate().map_err(|e| e.to_string())?.serialize_pem())
}

/// A server certificate for these names over a new key of its own (see `make_server_with_key`).
pub fn make_server(ca: &Pem, names: &[String]) -> Result<Pem, String> {
    make_server_with_key(ca, names, &make_server_key()?)
}

/// A server certificate for these names (IP addresses or host names), signed by the CA, over the
/// server key `key` (PEM). 397 days: iPhones refuse longer ones from a CA a person installed.
pub fn make_server_with_key(ca: &Pem, names: &[String], key: &str) -> Result<Pem, String> {
    let key = KeyPair::from_pem(key).map_err(|e| format!("the server key is unreadable: {e}"))?;
    let ca_key = KeyPair::from_pem(&ca.key).map_err(|e| format!("the local CA key is unreadable: {e}"))?;
    // The issuer is the same name and key as the saved CA certificate, so the chain checks.
    let issuer = ca_params().self_signed(&ca_key).map_err(|e| e.to_string())?;
    let mut p = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, names.first().map_or("Rhema Studio", String::as_str));
    p.distinguished_name = dn;
    p.subject_alt_names = names
        .iter()
        .map(|n| match n.parse::<std::net::IpAddr>() {
            Ok(ip) => Ok(SanType::IpAddress(ip)),
            Err(_) => n.clone().try_into().map(SanType::DnsName).map_err(|e: rcgen::Error| e.to_string()),
        })
        .collect::<Result<_, _>>()?;
    p.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    p.key_usages = vec![KeyUsagePurpose::DigitalSignature, KeyUsagePurpose::KeyEncipherment];
    let now = std::time::SystemTime::now();
    p.not_before = (now - std::time::Duration::from_secs(86_400)).into();
    p.not_after = (now + std::time::Duration::from_secs(397 * 86_400)).into();
    let cert = p.signed_by(&key, &issuer, &ca_key).map_err(|e| e.to_string())?;
    Ok(Pem { cert: cert.pem(), key: key.serialize_pem() })
}

/// SHA-256 of the server certificate's DER, lowercase hex: what a Rhema Receiver TV insists on when
/// it opens a feed over https (#198), since its WebView does not know the local CA.
pub fn fingerprint(server: &Pem) -> Result<String, String> {
    use rustls::pki_types::{pem::PemObject, CertificateDer};
    use sha2::{Digest, Sha256};
    let leaf = CertificateDer::pem_slice_iter(server.cert.as_bytes()).next().ok_or("no certificate")?.map_err(|e| e.to_string())?;
    Ok(hex(&Sha256::digest(leaf.as_ref())))
}

/// SHA-256 of the server certificate's `SubjectPublicKeyInfo` DER, lowercase hex (doc 48): the same for
/// every certificate over the same server key, whatever addresses it names or when it was made. What
/// a Receiver or Rhema Cam pins from now on, next to the legacy `fingerprint` of the whole certificate.
pub fn spki_fingerprint(server: &Pem) -> Result<String, String> {
    use rustls::pki_types::{pem::PemObject, CertificateDer};
    use sha2::{Digest, Sha256};
    let leaf = CertificateDer::pem_slice_iter(server.cert.as_bytes()).next().ok_or("no certificate")?.map_err(|e| e.to_string())?;
    let parsed = rustls::server::ParsedCertificate::try_from(&leaf).map_err(|e| e.to_string())?;
    Ok(hex(&Sha256::digest(parsed.subject_public_key_info().as_ref())))
}

/// SHA-256 of a key pair's public key (`SubjectPublicKeyInfo` DER), lowercase hex: equal to the
/// `spki_fingerprint` of every certificate made over it.
pub fn key_fingerprint(key: &str) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let key = KeyPair::from_pem(key).map_err(|e| format!("the server key is unreadable: {e}"))?;
    Ok(hex(&Sha256::digest(key.public_key_der())))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

/// The rustls server config for a certificate (with its CA after it, as a chain).
pub fn server_config(server: &Pem, ca_cert: &str) -> Result<std::sync::Arc<rustls::ServerConfig>, String> {
    use rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
    let mut chain: Vec<CertificateDer<'static>> = CertificateDer::pem_slice_iter(server.cert.as_bytes()).collect::<Result<_, _>>().map_err(|e| e.to_string())?;
    chain.extend(CertificateDer::pem_slice_iter(ca_cert.as_bytes()).collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?);
    let key = PrivateKeyDer::from_pem_slice(server.key.as_bytes()).map_err(|e| e.to_string())?;
    let config = rustls::ServerConfig::builder_with_provider(std::sync::Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(chain, key)
        .map_err(|e| e.to_string())?;
    Ok(std::sync::Arc::new(config))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_server_certificate_is_signed_by_the_local_ca_for_its_addresses() {
        let ca = make_ca().unwrap();
        assert!(ca.cert.starts_with("-----BEGIN CERTIFICATE-----") && ca.key.contains("PRIVATE KEY"));
        let server = make_server(&ca, &["192.168.1.20".into(), "localhost".into()]).unwrap();
        assert!(server_config(&server, &ca.cert).is_ok());
        // A second server certificate from the same saved CA (the next start) also builds.
        assert!(make_server(&ca, &["10.0.0.5".into()]).is_ok());
        assert!(make_server(&Pem { cert: ca.cert.clone(), key: "nonsense".into() }, &["10.0.0.5".into()]).is_err());
    }

    /// Whether a client that installed only this CA accepts `server` for `name`.
    fn trusted(ca: &Pem, server: &Pem, name: &str) -> bool {
        use rustls::client::danger::ServerCertVerifier;
        use rustls::pki_types::{pem::PemObject, CertificateDer, ServerName, UnixTime};
        let mut roots = rustls::RootCertStore::empty();
        for c in CertificateDer::pem_slice_iter(ca.cert.as_bytes()) {
            roots.add(c.unwrap()).unwrap();
        }
        let verifier = rustls::client::WebPkiServerVerifier::builder_with_provider(std::sync::Arc::new(roots), std::sync::Arc::new(rustls::crypto::ring::default_provider())).build().unwrap();
        let leaf = CertificateDer::pem_slice_iter(server.cert.as_bytes()).next().unwrap().unwrap();
        verifier.verify_server_cert(&leaf, &[], &ServerName::try_from(name.to_string()).unwrap(), &[], UnixTime::now()).is_ok()
    }

    #[test]
    fn a_server_certificate_has_a_stable_fingerprint_of_its_own() {
        let ca = make_ca().unwrap();
        let server = make_server(&ca, &["192.168.1.20".into()]).unwrap();
        let f = fingerprint(&server).unwrap();
        assert_eq!(f.len(), 64);
        assert!(f.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
        assert_eq!(fingerprint(&server).unwrap(), f, "the same certificate, the same fingerprint");
        assert_ne!(fingerprint(&make_server(&ca, &["192.168.1.20".into()]).unwrap()).unwrap(), f, "a new certificate, another one");
        assert_ne!(fingerprint(&Pem { cert: ca.cert.clone(), key: String::new() }).unwrap(), f, "the leaf, not the CA");
        assert!(fingerprint(&Pem { cert: "nonsense".into(), key: String::new() }).is_err());
    }

    #[test]
    fn certificates_over_one_server_key_share_its_spki_fingerprint() {
        let ca = make_ca().unwrap();
        let key = make_server_key().unwrap();
        let here = make_server_with_key(&ca, &["192.168.1.20".into(), "localhost".into()], &key).unwrap();
        let moved = make_server_with_key(&ca, &["10.0.0.5".into()], &key).unwrap();
        // Another address (or a renewal): another certificate, so the legacy pin changes...
        assert_ne!(fingerprint(&here).unwrap(), fingerprint(&moved).unwrap());
        // ...but the key pin does not, and it is the hash of the key's own public key.
        let pin = spki_fingerprint(&here).unwrap();
        assert_eq!(pin.len(), 64);
        assert!(pin.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
        assert_eq!(spki_fingerprint(&moved).unwrap(), pin);
        assert_eq!(key_fingerprint(&key).unwrap(), pin);
        assert_ne!(pin, fingerprint(&here).unwrap(), "the key, not the whole certificate");
        // A certificate over the given key is served with that key.
        assert_eq!(key_fingerprint(&moved.key).unwrap(), pin);
        assert!(server_config(&moved, &ca.cert).is_ok());
        // Another key: another pin; the CA's key is not the server's.
        assert_ne!(spki_fingerprint(&make_server(&ca, &["192.168.1.20".into()]).unwrap()).unwrap(), pin);
        assert_ne!(spki_fingerprint(&Pem { cert: ca.cert.clone(), key: String::new() }).unwrap(), pin);
        assert!(spki_fingerprint(&Pem { cert: "nonsense".into(), key: String::new() }).is_err());
        assert!(key_fingerprint("nonsense").is_err());
        assert!(make_server_with_key(&ca, &["10.0.0.5".into()], "nonsense").is_err());
    }

    #[test]
    fn the_local_ca_is_trusted_for_the_church_network_only() {
        let ca = make_ca().unwrap();
        assert!(trusted(&ca, &make_server(&ca, &["192.168.3.86".into()]).unwrap(), "192.168.3.86"));
        assert!(trusted(&ca, &make_server(&ca, &["10.1.2.3".into(), "localhost".into()]).unwrap(), "localhost"));
        // Even signed by the CA (its key stolen), a public address or website is refused.
        assert!(!trusted(&ca, &make_server(&ca, &["8.8.8.8".into()]).unwrap(), "8.8.8.8"));
        assert!(!trusted(&ca, &make_server(&ca, &["bank.example.com".into()]).unwrap(), "bank.example.com"));
    }
}
