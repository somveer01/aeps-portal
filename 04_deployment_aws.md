# Deploying the AEPS Portal on AWS

This app ships as a **one-command Docker deploy**: three containers — **web** (nginx serving the Expo
web bundle + reverse-proxying `/api` and `/uploads`), **api** (Node/Express), and **db**
(PostgreSQL 17). Only the web container is exposed (port 80). Good for a single EC2 box; §7 has the
managed/scaled path (RDS + S3 + CloudFront).

```
Internet ── :80/:443 ──▶ web (nginx)  ──/api,/uploads──▶ api (Node:3000) ──▶ db (Postgres)
                         serves SPA                        uploads volume     db_data volume
```

## 0. Prerequisites
- An AWS account (you're signed in) and, optionally, a domain name.
- Files added to the repo for this: `docker-compose.yml`, `api/Dockerfile`, `app/Dockerfile`,
  `app/nginx.conf`, `.env.production.example`.

## 1. Launch an EC2 instance
1. EC2 → **Launch instance**. AMI: **Ubuntu Server 24.04 LTS**. Type: **t3.medium** recommended
   (the web/Metro build is memory-hungry; t3.small works only if you add swap — see §8).
2. Key pair: create/download one (for SSH).
3. **Security group** — inbound rules:
   - SSH `22` from **My IP** only.
   - HTTP `80` from `0.0.0.0/0`.
   - HTTPS `443` from `0.0.0.0/0` (for TLS in §6).
4. Storage: 20 GB gp3. Launch.
5. EC2 → **Elastic IPs** → allocate + associate to the instance (stable public IP).

## 2. Install Docker
SSH in (`ssh -i key.pem ubuntu@<ELASTIC_IP>`), then:
```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER && newgrp docker
```

## 3. Get the code onto the server
Either `git clone <your-repo-url> fintech && cd fintech`, or from your PC:
`scp -i key.pem -r C:\FintechApp ubuntu@<ELASTIC_IP>:~/fintech` then `cd ~/fintech`.

## 4. Configure secrets
```bash
cp .env.production.example .env
nano .env
```
Set at minimum: `PGPASSWORD`, `JWT_SECRET` (`openssl rand -hex 32`), `SEED_ADMIN_PASSWORD`,
`CORS_ORIGINS` (your domain/IP). Keep `APP_MODE=mock` until real providers are wired. Leave
`RUN_SEED=true` for the first boot only.

## 5. Build & run
```bash
docker compose up -d --build      # first run: builds images, migrates, seeds admin+retailer+operators
docker compose ps                 # all healthy?
docker compose logs -f api        # watch startup / OTP output (dev SMS)
```
Verify:
```bash
curl http://localhost/api/health   # {"ok":true,"mode":"mock",...}
```
Open `http://<ELASTIC_IP>/` in a browser → login screen. Admin `admin` / your `SEED_ADMIN_PASSWORD`;
retailer `retailer` / `Retailer@123`.

**After the first successful boot:** set `RUN_SEED=false` in `.env` and `docker compose up -d` again
(prevents re-seeding on restarts; migrations still run automatically).

## 6. Domain + HTTPS (recommended)
1. Point an **A record** for your domain at the Elastic IP; put the domain in `CORS_ORIGINS`.
2. Easiest TLS — a Caddy reverse proxy in front (auto Let's Encrypt). On the host:
```bash
sudo apt-get install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
your-domain.com {
  reverse_proxy 127.0.0.1:80
}
EOF
sudo systemctl restart caddy
```
   (Alternatives: an **AWS ALB + ACM certificate** in front of the instance, or **CloudFront**.)

## 7. Managed / production-grade upgrade (optional)
- **Database → Amazon RDS for PostgreSQL:** create an RDS instance; drop the `db` service and point
  `PGHOST/PGUSER/PGPASSWORD/PGDATABASE` (+ `PGSSL=true`) at RDS. Managed backups + failover.
- **Web + uploads → S3 + CloudFront:** host the exported `app/dist` on S3 behind CloudFront; move
  uploads to S3 (introduce a storage adapter — see `01_spect_admin_document.md` §14). Keeps the box
  stateless.
- **Secrets → AWS SSM Parameter Store / Secrets Manager** instead of a plaintext `.env`.
- **Scale:** run api on ECS/Fargate behind an ALB; RDS + ElastiCache as needed.

## 8. Operations
- **Update:** `git pull && docker compose up -d --build` (migrations auto-run on api start).
- **Logs:** `docker compose logs -f web|api|db`.
- **DB backup:** `docker compose exec db pg_dump -U $PGUSER $PGDATABASE > backup_$(date +%F).sql`.
- **DB restore:** `cat backup.sql | docker compose exec -T db psql -U $PGUSER -d $PGDATABASE`.
- **Low-RAM build (t3.small):** add swap before `up --build`:
  `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`.

## 9. Go-live security checklist
- [ ] Changed `SEED_ADMIN_PASSWORD`, `PGPASSWORD`, `JWT_SECRET` from the examples.
- [ ] `RUN_SEED=false`, `DEV_MASTER_OTP=` empty, `CAPTCHA_DEV_ECHO=false`.
- [ ] Real SMS via `SMS_PROVIDER=msg91` (or keep `dev` only for a demo).
- [ ] `APP_MODE` = `mock` for demo, or `live` once providers are configured.
- [ ] HTTPS enabled (§6); SSH (22) restricted to your IP.
- [ ] Delete or disable the demo `retailer` account if not needed.
- [ ] Backups scheduled (cron `pg_dump`, or RDS automated backups).

**IP note:** independent original implementation; no third-party branding. See `NOTICE.md`.
