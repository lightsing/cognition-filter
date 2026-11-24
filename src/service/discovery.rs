use super::{App, State};
use crate::ports::PREFERRED_PORT;
use axum::{Json, extract::RawQuery, http::StatusCode};
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use subtle::ConstantTimeEq;

fn tag(token: &str, message: &str) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(token.as_bytes()).expect("HMAC accepts all key sizes");
    mac.update(message.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

pub(super) fn credential(token: &str, port: u16) -> String {
    tag(token, &format!("cognition-filter/auth/v1|{port}"))
}

pub(super) fn authorized(authorization: &str, token: &str, derived: &str, port: u16) -> bool {
    let pair = if let Some(actual) = authorization.strip_prefix("CF-Port ") {
        (actual, derived)
    } else if port == PREFERRED_PORT
        && let Some(actual) = authorization.strip_prefix("Bearer ")
    {
        (actual, token)
    } else {
        return false;
    };
    bool::from(pair.0.as_bytes().ct_eq(pair.1.as_bytes()))
}

fn proof(token: &str, port: u16, nonce: &str) -> String {
    tag(token, &format!("cognition-filter/v1|{port}|{nonce}"))
}

pub(super) async fn probe(
    State(app): State<App>,
    RawQuery(query): RawQuery,
) -> Result<Json<Value>, StatusCode> {
    let nonce = query
        .as_deref()
        .and_then(|q| q.strip_prefix("nonce="))
        .ok_or(StatusCode::BAD_REQUEST)?;
    if nonce.len() != 32
        || !nonce
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let signature = proof(&app.lock().store.token, app.port, nonce);
    Ok(Json(
        json!({"service":"cognition-filter","protocol":1,"port":app.port,"proof":signature}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    const TOKEN: &str = "00112233445566778899aabbccddeeff0011223344556677";

    #[test]
    fn signatures_match_cross_language_vectors_and_use_distinct_domains() {
        let key = credential(TOKEN, 64881);
        assert_eq!(
            key,
            "85b974361616c33182ec82ae7a150c4bba6214ef735ae2b2ff08c30fa253afd3"
        );
        let proof = proof(TOKEN, 64881, "00112233445566778899aabbccddeeff");
        assert_eq!(
            proof,
            "ec694decde53acd366563edae759f487746c66a3ef40a4bc4f832c985748d74c"
        );
        assert!(authorized(&format!("CF-Port {key}"), TOKEN, &key, 64881));
        assert!(!authorized(&format!("CF-Port {proof}"), TOKEN, &key, 64881));
        assert!(authorized(
            &format!("Bearer {TOKEN}"),
            TOKEN,
            &credential(TOKEN, 17321),
            17321
        ));
        assert!(!authorized(&format!("Bearer {TOKEN}"), TOKEN, &key, 64881));
    }
}
