"""
Cognito JWT verification.

Every protected endpoint depends on `CurrentUser`, which forces FastAPI to
run `verify_token` first. If the token missing / expired / signed by
unknown key, the request is rejected with 401 before the handler runs
"""

import time
from functools import lru_cache
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt, JWTError

from .config import settings

# Tells FastAPI to look for Authorization: Bearer <token> header
bearer = HTTPBearer()


# Cognito publishes the public keys (JWKS) used to sign user tokens
# at a well-known URL. 
# Cache  in-memory so we don't fetch on every request. they rarely rotate
@lru_cache(maxsize=1)
def _jwks() -> dict:
    url = (
        f"https://cognito-idp.{settings.aws_region}.amazonaws.com/"
        f"{settings.cognito_user_pool_id}/.well-known/jwks.json"
    )
    return httpx.get(url, timeout=5).json()


def verify_token(
    creds: Annotated[HTTPAuthorizationCredentials, Depends(bearer)],
) -> dict:
    token = creds.credentials

    # Expected issuer — must match the pool that issued the token.
    expected_iss = (
        f"https://cognito-idp.{settings.aws_region}.amazonaws.com/"
        f"{settings.cognito_user_pool_id}"
    )

    try:
        # The token header tells us which JWKS key was used to sign it.
        kid = jwt.get_unverified_headers(token)["kid"]
        key = next((k for k in _jwks()["keys"] if k["kid"] == kid), None)
        if key is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown signing key")

        # Frontend sends the Cognito ID token (token_use == "id"), so aud == client_id.
        # Decode and verify signature + audience in one step.
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=settings.cognito_client_id,
        )

        # Validate issuer — prevents tokens from a different Cognito pool
        # (even one with the same key id) being accepted.
        if claims.get("iss") != expected_iss:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token issuer")

        # Enforce ID-token type — rejects access tokens sent by mistake,
        # which would pass the signature check but lack the user-profile claims
        # (email, given_name, etc.) that downstream handlers rely on.
        if claims.get("token_use") != "id":
            raise HTTPException(
                status.HTTP_401_UNAUTHORIZED,
                "Expected an ID token (token_use=id)",
            )

        if claims["exp"] < time.time():
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")

        return claims
    except JWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}")


# Shorthand so routes can just write `user: CurrentUser` instead of
# repeating the Depends(...) machinery on every endpoint
CurrentUser = Annotated[dict, Depends(verify_token)]