"""FastAPI application and AWS Lambda adapter for the EcoLens backend.

RESTful API surface
-------------------
  GET    /health                               public health probe
  GET    /users/me                             authenticated user info

  POST   /uploads                              initiate a media upload (presign + dedup)

  GET    /media?tag=koala:2&tag=wombat:1       search by tag counts (AND, min count)
  GET    /media?species=koala&species=dingo    search by species    (AND, count >= 1)
  GET    /media/{file_id}                      resolve file_id → full-size URL
  POST   /media/similar/presign                get a presigned S3 PUT URL for a query file
  POST   /media/similar                        find similar by reference file (two-step, no size limit)
  POST   /media/tags                           bulk add / remove tags
  DELETE /media                                delete files, thumbnails, and DB records

  POST   /subscriptions                        subscribe to species-watch notifications
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from .auth import CurrentUser
from .config import settings
from .routers import media, notifications, upload

app = FastAPI(
    title="Aussie EcoLens API",
    version="1.0.0",
    description=(
        "RESTful API for uploading, searching, tagging, and managing wildlife media. "
        "All endpoints require a Cognito JWT (Bearer token) except /health."
    ),
)

# Build an explicit allow-list so credentialed requests (Authorization header)
# are accepted. Browsers reject allow_credentials=True with a wildcard origin.
# Set FRONTEND_ORIGIN to the CloudFront distribution URL in production,
# e.g. https://d123abc.cloudfront.net
_origins = ["http://localhost:5173", "http://localhost:3000"]
if settings.frontend_origin:
    _origins.append(settings.frontend_origin.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Public endpoints ──────────────────────────────────────────────────────────

@app.get("/health", tags=["health"])
def health():
    """Public health probe — no auth required. Used for uptime checks."""
    return {"status": "ok"}


@app.get("/users/me", tags=["users"])
def me(user: CurrentUser):
    """Return the authenticated user's Cognito sub and email.

    Good first endpoint to call from the frontend after login to confirm
    the JWT is being accepted correctly.
    """
    return {"sub": user["sub"], "email": user.get("email")}


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(upload.router,        prefix="/uploads",       tags=["uploads"])
app.include_router(media.router,         prefix="/media",         tags=["media"])
app.include_router(notifications.router, prefix="/subscriptions", tags=["subscriptions"])

# Mangum adapts the ASGI app so it can run inside AWS Lambda behind API Gateway.
handler = Mangum(app)
