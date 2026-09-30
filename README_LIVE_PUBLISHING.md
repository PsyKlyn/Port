# Live publishing setup

The editor now publishes through the Flask backend instead of writing files into the visitor's filesystem. Public visitors can only read published write-ups. Publishing requires admin login + TOTP MFA.

## Local

```bash
python -m venv .venv
.venv\\Scripts\\activate   # Windows
pip install -r requirements.txt
```

Set environment variables from `.env.example`, then run:

```bash
python app.py
```

Open `http://127.0.0.1:5000/admin/login`.

## Render

1. Create a Render Web Service from this repository.
2. Build command: `pip install -r requirements.txt`
3. Start command: `gunicorn app:app`
4. Create a Render PostgreSQL database and connect its `DATABASE_URL` to the service.
5. Add `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_TOTP_SECRET` as secret environment variables.
6. Deploy.

After that:

`/admin/login` → MFA → `/editor.html` → Publish Write-up → PostgreSQL → `/writeups.html`

No GitHub push or Render redeploy is required for each new write-up.
