//! Rhema's side of the code check with a Rhema Receiver TV (#198), before a feed's secret link is sent.
//! Rhema and the TV each prove they know the code on the TV's screen; the code never crosses the
//! network, and a device that only pretends to be a receiver cannot learn the code from Rhema.
//!
//! A plain hash of the code is not enough: six digits are a million guesses, under a second for a
//! computer, so anyone who saw the hash would know the code. This is SPAKE2 (a password-authenticated
//! key exchange) in the 2048-bit group of RFC 3526: someone who does not know the code can test one
//! guess per exchange, by taking part in it, and the TV counts every exchange as a try. The address
//! Rhema reached the TV at is part of the proof, so a device that passes the messages on to the real TV
//! cannot use its answer. The TV's side is android-tv/.../CodeProof.java; both must stay the same
//! (android-tv/build.sh replays the test vector below on the Java side).
//!
//! Two keys come from the exchange's secret (HKDF-SHA256): one for the TV's proof, one that encrypts
//! what Rhema sends in /show (AES-256-GCM): the feed's https link and the fingerprint of Rhema's
//! certificate. So someone watching the network learns neither, and the TV opens the page only from
//! the computer that has that certificate.

use hmac::{Hmac, Mac};
use num_bigint::BigUint;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

const P_HEX: &str = concat!(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD",
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED",
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F",
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B",
    "E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510",
    "15728E5A8AACAA68FFFFFFFFFFFFFFFF",
);
const LEN: usize = 256;

struct Group {
    p: BigUint,
    q: BigUint,
    g: BigUint,
    m: BigUint,
    n: BigUint,
}

fn group() -> &'static Group {
    static GROUP: OnceLock<Group> = OnceLock::new();
    GROUP.get_or_init(|| {
        let p = BigUint::parse_bytes(P_HEX.as_bytes(), 16).expect("the RFC 3526 prime");
        let q = &p >> 1usize;
        let (m, n) = (element(&p, "rhema-tv M"), element(&p, "rhema-tv N"));
        Group { p, q, g: BigUint::from(2u8), m, n }
    })
}

/// A fixed group element nobody knows the logarithm of: a long hash of the label, squared.
fn element(p: &BigUint, label: &str) -> BigUint {
    let mut all = Vec::with_capacity(9 * 32);
    for i in 0..9u8 {
        all.extend_from_slice(&Sha256::new().chain_update(label.as_bytes()).chain_update([i]).finalize());
    }
    (BigUint::from_bytes_be(&all) % p).modpow(&BigUint::from(2u8), p)
}

fn w(code: &str) -> BigUint {
    BigUint::from_bytes_be(&Sha256::digest(format!("rhema-tv code:{code}").as_bytes())) % &group().q
}

fn fixed(v: &BigUint) -> [u8; LEN] {
    let b = v.to_bytes_be();
    let mut out = [0u8; LEN];
    let n = b.len().min(LEN);
    out[LEN - n..].copy_from_slice(&b[b.len() - n..]);
    out
}

/// A group value as the TV writes it: lowercase hex, at most 512 digits (no sign, no `_`).
fn value(hex: &str) -> Option<BigUint> {
    let ok = !hex.is_empty() && hex.len() <= 2 * LEN && hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if ok { BigUint::parse_bytes(hex.as_bytes(), 16) } else { None }
}

fn in_group(v: &BigUint) -> bool {
    let g = group();
    *v > BigUint::from(1u8) && *v < &g.p - 1u8 && v.modpow(&g.q, &g.p) == BigUint::from(1u8)
}

fn hmac(key: &[u8], message: &[u8]) -> Hmac<Sha256> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("any key length");
    mac.update(message);
    mac
}

/// HKDF-SHA256 (RFC 5869) with no salt and one 32-byte block: a separate key for each use.
fn derive(secret: &[u8], info: &str) -> [u8; 32] {
    let prk = hmac(&[0u8; 32], secret).finalize().into_bytes();
    let mut block = info.as_bytes().to_vec();
    block.push(1);
    hmac(&prk, &block).finalize().into_bytes().into()
}

/// What /show is encrypted with, so the TV can tell what Rhema sent from anything else.
const SHOW_AAD: &[u8] = b"rhema-tv show";

/// The keys of one exchange whose proof checked: what Rhema seals /show with.
pub struct Keys {
    #[cfg(test)]
    transcript: [u8; 32],
    enc: [u8; 32],
}

impl Keys {
    /// AES-256-GCM: the ciphertext with its 16-byte tag after it, as Java's GCM writes it.
    fn seal_with(&self, nonce: [u8; 12], plain: &[u8]) -> Vec<u8> {
        use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
        let key = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &self.enc).expect("a 32-byte key"));
        let mut out = plain.to_vec();
        key.seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(SHOW_AAD), &mut out).expect("a short message");
        out
    }

    /// /show's body for this text: a fresh random nonce and the sealed text, both hex.
    pub fn seal(&self, plain: &[u8]) -> Result<serde_json::Value, String> {
        let mut nonce = [0u8; 12];
        getrandom::getrandom(&mut nonce).map_err(|e| format!("No randomness to send the link: {e}"))?;
        Ok(serde_json::json!({ "nonce": to_hex(&nonce), "data": to_hex(&self.seal_with(nonce, plain)) }))
    }
}

/// One exchange, from Rhema's side.
pub struct Desk {
    x: BigUint,
    w: BigUint,
    public: BigUint,
}

impl Desk {
    /// Starts an exchange for the code the operator typed.
    pub fn start(code: &str) -> Result<Self, String> {
        let mut bytes = [0u8; 40];
        getrandom::getrandom(&mut bytes).map_err(|e| format!("No randomness for the code check: {e}"))?;
        Ok(Self::with_exponent(code, BigUint::from_bytes_be(&bytes) + 1u8))
    }

    fn with_exponent(code: &str, x: BigUint) -> Self {
        let g = group();
        let w = w(code);
        let public = g.g.modpow(&x, &g.p) * g.m.modpow(&w, &g.p) % &g.p;
        Self { x, w, public }
    }

    /// What Rhema sends first (hex).
    pub fn public_hex(&self) -> String {
        self.public.to_str_radix(16)
    }

    /// Checks the TV's answer for the address Rhema reached it at ("ip:port"). The keys when the TV
    /// knew the same code (its proof compared in constant time), else None.
    pub fn finish(&self, y_hex: &str, address: &str, tv_proof_hex: &str) -> Option<Keys> {
        let g = group();
        let y = value(y_hex)?;
        if !in_group(&y) {
            return None;
        }
        // Y / N^w, by Fermat: N^(w(p-2)) is the inverse of N^w.
        let n_w_inverse = g.n.modpow(&self.w, &g.p).modpow(&(&g.p - 2u8), &g.p);
        let k = (y.clone() * n_w_inverse % &g.p).modpow(&self.x, &g.p);
        if k == BigUint::from(1u8) {
            return None;
        }
        let key: [u8; 32] = Sha256::new()
            .chain_update(b"rhema-tv-1")
            .chain_update(fixed(&self.public))
            .chain_update(fixed(&y))
            .chain_update(fixed(&k))
            .chain_update(fixed(&self.w))
            .chain_update(address.as_bytes())
            .finalize()
            .into();
        let sent = decode_hex(tv_proof_hex)?;
        hmac(&derive(&key, "rhema-tv confirm"), b"tv").verify_slice(&sent).ok()?;
        Some(Keys {
            #[cfg(test)]
            transcript: key,
            enc: derive(&key, "rhema-tv enc"),
        })
    }
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
        s
    })
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() != 64 || !s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// The TV's side, as CodeProof.answer does it, for tests here and in join.rs.
    pub(crate) fn tv_answer(x_hex: &str, code: &str, address: &str, y: &BigUint) -> Option<(String, String, [u8; 32])> {
        let g = group();
        let x = BigUint::parse_bytes(x_hex.as_bytes(), 16)?;
        if !in_group(&x) {
            return None;
        }
        let w = w(code);
        let public = g.g.modpow(y, &g.p) * g.n.modpow(&w, &g.p) % &g.p;
        let m_w_inverse = g.m.modpow(&w, &g.p).modpow(&(&g.p - 2u8), &g.p);
        let k = (x.clone() * m_w_inverse % &g.p).modpow(y, &g.p);
        let key: [u8; 32] = Sha256::new()
            .chain_update(b"rhema-tv-1")
            .chain_update(fixed(&x))
            .chain_update(fixed(&public))
            .chain_update(fixed(&k))
            .chain_update(fixed(&w))
            .chain_update(address.as_bytes())
            .finalize()
            .into();
        let proof = to_hex(&hmac(&derive(&key, "rhema-tv confirm"), b"tv").finalize().into_bytes());
        Some((public.to_str_radix(16), proof, derive(&key, "rhema-tv enc")))
    }

    /// The TV's side of /show, as CodeProof.open does it: the text, or None.
    pub(crate) fn tv_open(enc: &[u8; 32], nonce_hex: &str, data_hex: &str) -> Option<String> {
        use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
        let nonce: [u8; 12] = hex_bytes(nonce_hex)?.try_into().ok()?;
        let mut data = hex_bytes(data_hex)?;
        let key = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, enc).ok()?);
        let plain = key.open_in_place(Nonce::assume_unique_for_key(nonce), Aad::from(SHOW_AAD), &mut data).ok()?;
        String::from_utf8(plain.to_vec()).ok()
    }

    fn hex_bytes(s: &str) -> Option<Vec<u8>> {
        if s.len() % 2 != 0 || !s.is_ascii() {
            return None;
        }
        (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
    }

    #[test]
    fn tv_proof_hmac_matches_the_rfc_4231_vector() {
        // RFC 4231 test case 2.
        let mac = hmac(b"Jefe", b"what do ya want for nothing?").finalize().into_bytes();
        let hex = to_hex(&mac);
        assert_eq!(hex, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    /// The shared test vector: Rhema's x = 12345678901234567890, the TV's y = 98765432109876543210,
    /// code 123456, the TV at 192.168.3.37:8095. android-tv/test/.../CodeProofCheck.java checks the
    /// same values on the TV's side, from its own code; both must agree to the byte.
    const VECTOR_Y: &str = "e38b82b80531e4786ca069f21a46e3db64b0fc92d5db31f281e44f3e2b96ad98559261b93f17148e84b1aa8e43441246fcc1ece94c8e516661574a9b16b842bc46ddf45b672c8e3d0a03746d2aff684230d99fccc67a53dc6a4e2922096acaa9400b412cfcfab4bcb3ef5373ac75d68dcd4faa11a29cd1af0b8ce51f32c947e22f7eab7ab267ccc9cc16e7ebc8304da0a160ecddf02f9765f1ea1e5b92fc82facdbc7d03806b170c1662487a46d72b79c21d1323edf3d3f62dfaab655c636869ff1f6b6d011e75049e9630b51d9ca4ef2d3cd150f06b1b8229eeab7baf7fd1b6778a80309a6fbdfe07503707fc4019691ac3094effc376ad9d14ee0ab0ed5922";
    const VECTOR_PROOF: &str = "a9841532dd2e0c74ca00d4b8e00eba7bd2204068747a4c0d4846eb287a70355b";
    const VECTOR_SHOW: &str = "3f169144b6eec6a7b137af19a89992e4ff6672cc90a463cd14738dbbd3317d1518e8abdd9a273366b47eb76e302c8783a934a5edce880084a6934cf6ed177f6fd4c85144ee4a625ab8b8b4c784e43e718ee095253f9037ba4845a4753298ac645ed6685367e136f2e939d5b43b416405b0034fb6c8d1503673b09ab04b86d43a284e39e611ef28b533a4d7fc1eee40a1ce6ffaade3";
    const VECTOR_PLAIN: &str = r#"{"url":"https://192.168.3.10:8081/feed/abc?k=x","certFingerprint":"abecce707af4a66a8aa18ce9624ebead97a8f362335dd688e9d5899af9428a19"}"#;

    fn vector_desk() -> Desk {
        Desk::with_exponent("123456", BigUint::parse_bytes(b"12345678901234567890", 10).unwrap())
    }

    #[test]
    fn tv_proof_matches_the_receivers_java_code() {
        let desk = vector_desk();
        assert!(desk.public_hex().starts_with("2393ea81a58767ec5ab69cfe207325733b44f4e4"));
        let keys = desk.finish(VECTOR_Y, "192.168.3.37:8095", VECTOR_PROOF).expect("the TV's proof");
        // The exchange's secret is the one receiver 1.2 made; the proof and encryption keys come from it.
        assert_eq!(to_hex(&keys.transcript), "73911ba62c97ac2abd114fb1c6806385bc0f594cedd20b71866f8b8db833f85d");
        assert_eq!(to_hex(&keys.enc), "a31f06ca466a6687b837d3736be4e2d2a36f2d7f002b0afba0682e992ca20ecf");
        let mut nonce = [0u8; 12];
        nonce.iter_mut().enumerate().for_each(|(i, b)| *b = i as u8);
        assert_eq!(to_hex(&keys.seal_with(nonce, VECTOR_PLAIN.as_bytes())), VECTOR_SHOW);
        // The same answer for another address (passed on to the real TV) or a changed proof is refused.
        assert!(desk.finish(VECTOR_Y, "192.168.3.99:8095", VECTOR_PROOF).is_none());
        assert!(desk.finish(VECTOR_Y, "192.168.3.37:8095", &format!("b{}", &VECTOR_PROOF[1..])).is_none());
        // Receiver 1.2's proof (made with the secret itself) no longer passes.
        assert!(desk.finish(VECTOR_Y, "192.168.3.37:8095", "593950f805179eff94d85dacba62e16c1e6241de03d834e69a9a6f33acbabe40").is_none());
    }

    #[test]
    fn tv_proof_keys_come_from_hkdf_sha256() {
        // RFC 5869 test case 3 (no salt, no info): the first 32 bytes of its output.
        assert_eq!(to_hex(&derive(&[0x0b; 22], "")), "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d");
        let secret = [7u8; 32];
        assert_ne!(derive(&secret, "rhema-tv confirm"), derive(&secret, "rhema-tv enc"), "one key per use");
    }

    #[test]
    fn tv_show_is_sealed_so_only_that_exchange_opens_it() {
        let keys = vector_desk().finish(VECTOR_Y, "192.168.3.37:8095", VECTOR_PROOF).unwrap();
        let body = keys.seal(VECTOR_PLAIN.as_bytes()).unwrap();
        let (nonce, data) = (body["nonce"].as_str().unwrap(), body["data"].as_str().unwrap());
        assert_eq!(nonce.len(), 24, "a 12-byte nonce");
        assert_eq!(data.len(), 2 * (VECTOR_PLAIN.len() + 16), "the text and its 16-byte tag");
        assert_eq!(tv_open(&keys.enc, nonce, data).as_deref(), Some(VECTOR_PLAIN));
        assert_ne!(keys.seal(VECTOR_PLAIN.as_bytes()).unwrap()["nonce"], body["nonce"], "a fresh nonce each time");
        // Changed on the way, another nonce, or another exchange's key: refused.
        let flipped = format!("{}{}", if data.starts_with('0') { "1" } else { "0" }, &data[1..]);
        assert_eq!(tv_open(&keys.enc, nonce, &flipped), None);
        assert_eq!(tv_open(&keys.enc, "000000000000000000000000", data), None);
        assert_eq!(tv_open(&[1u8; 32], nonce, data), None);
    }

    #[test]
    fn tv_proof_needs_the_same_code_on_both_sides() {
        let y = BigUint::from(987_654_321u64) << 200usize;
        let desk = Desk::start("482913").unwrap();
        let (y_hex, proof, enc) = tv_answer(&desk.public_hex(), "482913", "10.0.0.9:8095", &y).unwrap();
        assert_eq!(desk.finish(&y_hex, "10.0.0.9:8095", &proof).map(|k| k.enc), Some(enc));
        let (y_hex, proof, _) = tv_answer(&desk.public_hex(), "482914", "10.0.0.9:8095", &y).unwrap();
        assert!(desk.finish(&y_hex, "10.0.0.9:8095", &proof).is_none(), "a TV with another code");
        assert!(desk.finish("1", "10.0.0.9:8095", &proof).is_none(), "not a group value");
        assert!(desk.finish(&y_hex, "10.0.0.9:8095", "zz").is_none());
    }

    #[test]
    fn tv_proof_refuses_values_outside_the_group_or_chosen_to_cancel_the_code() {
        // The same refusals CodeProofCheck makes on the TV's side, here for the TV's value Y.
        let g = group();
        let desk = vector_desk();
        let n_w = g.n.modpow(&desk.w, &g.p);
        let bad = [BigUint::from(0u8), BigUint::from(1u8), &g.p - 1u8, g.p.clone(), &g.p + 1u8, n_w];
        let proof = VECTOR_PROOF;
        for (y, what) in bad.iter().zip(["0", "1", "p-1", "p", "p+1", "N^w (the key would be 1)"]) {
            assert!(desk.finish(&y.to_str_radix(16), "192.168.3.37:8095", proof).is_none(), "Y = {what}");
        }
        // Only lowercase hex, as the TV writes it.
        let y = VECTOR_Y;
        assert!(desk.finish(y, "192.168.3.37:8095", proof).is_some(), "the vector itself still passes");
        for odd in [format!("+{y}"), y.to_uppercase(), format!("{}_{}", &y[..10], &y[10..]), format!("0{y}0"), String::new()] {
            assert!(desk.finish(&odd, "192.168.3.37:8095", proof).is_none(), "{odd:.20}");
        }
        assert!(desk.finish(y, "192.168.3.37:8095", &proof.to_uppercase()).is_none(), "a proof in capitals");
        assert!(desk.finish(y, "192.168.3.37:8095", &format!("+{}", &proof[1..])).is_none(), "a proof with a sign");
    }
}
