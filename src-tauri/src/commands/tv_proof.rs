//! Rhema's side of the code check with a Rhema Receiver TV (#198), before a feed's secret link is sent.
//! Rhema and the TV each prove they know the code on the TV's screen; the code never crosses the
//! network, and a device that only pretends to be a receiver cannot learn the code from Rhema.
//!
//! A plain hash of the code is not enough: six digits are a million guesses, under a second for a
//! computer, so anyone who saw the hash would know the code. This is SPAKE2 (a password-authenticated
//! key exchange) in the 2048-bit group of RFC 3526: someone who does not know the code can test one
//! guess per exchange, by taking part in it, and the TV counts every exchange as a try. The address
//! Rhema reached the TV at is part of the proof, so a device that passes the messages on to the real TV
//! cannot use its answer. The TV's side is android-tv/.../CodeProof.java; both must stay the same.

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

fn in_group(v: &BigUint) -> bool {
    let g = group();
    *v > BigUint::from(1u8) && *v < &g.p - 1u8 && v.modpow(&g.q, &g.p) == BigUint::from(1u8)
}

fn hmac(key: &[u8], message: &[u8]) -> Hmac<Sha256> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("any key length");
    mac.update(message);
    mac
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

    /// Checks the TV's answer for the address Rhema reached it at ("ip:port"). The shared key when
    /// the TV knew the same code (compared in constant time), else None.
    pub fn finish(&self, y_hex: &str, address: &str, tv_proof_hex: &str) -> Option<[u8; 32]> {
        let g = group();
        let y = BigUint::parse_bytes(y_hex.as_bytes(), 16)?;
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
        hmac(&key, b"tv").verify_slice(&sent).ok()?;
        Some(key)
    }
}

/// Rhema's proof for the TV that it took part in this exchange, for this link (hex).
pub fn desk_proof(key: &[u8; 32], url: &str) -> String {
    to_hex(&hmac(key, format!("desk{url}").as_bytes()).finalize().into_bytes())
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        use std::fmt::Write;
        let _ = write!(s, "{b:02x}");
        s
    })
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() != 64 || !s.is_ascii() {
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
        let proof = to_hex(&hmac(&key, b"tv").finalize().into_bytes());
        Some((public.to_str_radix(16), proof, key))
    }

    #[test]
    fn tv_proof_hmac_matches_the_rfc_4231_vector() {
        // RFC 4231 test case 2.
        let mac = hmac(b"Jefe", b"what do ya want for nothing?").finalize().into_bytes();
        let hex = to_hex(&mac);
        assert_eq!(hex, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
    }

    #[test]
    fn tv_proof_matches_the_receivers_java_code() {
        // Made with android-tv's CodeProof.java (x and y fixed): Rhema must agree with it to the byte.
        let desk = Desk::with_exponent("123456", BigUint::parse_bytes(b"12345678901234567890", 10).unwrap());
        assert!(desk.public_hex().starts_with("2393ea81a58767ec5ab69cfe207325733b44f4e4"));
        let y = "e38b82b80531e4786ca069f21a46e3db64b0fc92d5db31f281e44f3e2b96ad98559261b93f17148e84b1aa8e43441246fcc1ece94c8e516661574a9b16b842bc46ddf45b672c8e3d0a03746d2aff684230d99fccc67a53dc6a4e2922096acaa9400b412cfcfab4bcb3ef5373ac75d68dcd4faa11a29cd1af0b8ce51f32c947e22f7eab7ab267ccc9cc16e7ebc8304da0a160ecddf02f9765f1ea1e5b92fc82facdbc7d03806b170c1662487a46d72b79c21d1323edf3d3f62dfaab655c636869ff1f6b6d011e75049e9630b51d9ca4ef2d3cd150f06b1b8229eeab7baf7fd1b6778a80309a6fbdfe07503707fc4019691ac3094effc376ad9d14ee0ab0ed5922";
        let key = desk.finish(y, "192.168.3.37:8095", "593950f805179eff94d85dacba62e16c1e6241de03d834e69a9a6f33acbabe40").expect("the TV's proof");
        let key_hex = to_hex(&key);
        assert_eq!(key_hex, "73911ba62c97ac2abd114fb1c6806385bc0f594cedd20b71866f8b8db833f85d");
        assert_eq!(desk_proof(&key, "http://192.168.3.10:8080/feed/abc?t=x"), "5eb4439439a464508ddb18b67f22cfeb276a8e0d2fbaca824de5c612a89d7917");
        // The same answer for another address (passed on to the real TV) or a changed proof is refused.
        assert!(desk.finish(y, "192.168.3.99:8095", "593950f805179eff94d85dacba62e16c1e6241de03d834e69a9a6f33acbabe40").is_none());
        assert!(desk.finish(y, "192.168.3.37:8095", "693950f805179eff94d85dacba62e16c1e6241de03d834e69a9a6f33acbabe40").is_none());
    }

    #[test]
    fn tv_proof_needs_the_same_code_on_both_sides() {
        let y = BigUint::from(987_654_321u64) << 200usize;
        let desk = Desk::start("482913").unwrap();
        let (y_hex, proof, key) = tv_answer(&desk.public_hex(), "482913", "10.0.0.9:8095", &y).unwrap();
        assert_eq!(desk.finish(&y_hex, "10.0.0.9:8095", &proof), Some(key));
        let (y_hex, proof, _) = tv_answer(&desk.public_hex(), "482914", "10.0.0.9:8095", &y).unwrap();
        assert_eq!(desk.finish(&y_hex, "10.0.0.9:8095", &proof), None, "a TV with another code");
        assert_eq!(desk.finish("1", "10.0.0.9:8095", &proof), None, "not a group value");
        assert_eq!(desk.finish(&y_hex, "10.0.0.9:8095", "zz"), None);
    }
}
