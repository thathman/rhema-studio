//! Opt-in https for the LAN listener (Rhema Comms, #251): a phone browser gives its microphone only
//! to a secure page. Rhema makes a local certificate authority once (kept in the app's data folder)
//! and, at each start, a certificate for this computer's current addresses signed by it. A phone
//! either accepts the browser's one-time warning or installs the CA (served at `/rhema-ca.pem`) to
//! trust it. Nothing leaves the church network; no outside service is involved.

use rcgen::{BasicConstraints, CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose, SanType};

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

/// A server certificate for these names (IP addresses or host names), signed by the CA. 397 days:
/// iPhones refuse longer ones from a CA a person installed.
pub fn make_server(ca: &Pem, names: &[String]) -> Result<Pem, String> {
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
    let key = KeyPair::generate().map_err(|e| e.to_string())?;
    let cert = p.signed_by(&key, &issuer, &ca_key).map_err(|e| e.to_string())?;
    Ok(Pem { cert: cert.pem(), key: key.serialize_pem() })
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
}
