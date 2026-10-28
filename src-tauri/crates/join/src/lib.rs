//! Joining a Rhema host on the church network (Host/Join, ARCH-004), shared by Rhema and Rhema
//! Companion (#209): find hosts by mDNS (#197), pair with the code on the host's screen, ask the
//! host what this computer's key may know, and follow its Live State. Rhema Studio Companion also talks
//! to its host over https with the host's certificate pinned (`pinned`), and both keep their saved
//! keys in the system's credential store (`keychain`).

pub mod discover;
pub mod host;
#[cfg(feature = "pinned")]
pub mod pin;
#[cfg(feature = "keychain")]
pub mod secrets;
