# Nginx HTTPS to HTTP Redirect Setup

This configuration sets up Nginx to:
1. Listen on port 443 (HTTPS) and redirect all traffic to port 80 (HTTP)
2. Proxy HTTP traffic from port 80 to the relayer service on port 8080

## Setup Instructions

### 1. SSL Certificates

The configuration uses the provided SSL certificates located at:
- `/home/ec2-user/fs4/ssl1.cert` - SSL certificate file
- `/home/ec2-user/fs4/ssl2.key` - SSL private key file

The start script will automatically copy these certificates to the `ssl/` directory when starting with Docker.

### 2. Start the Services

Using the start script (recommended):
```bash
RELAYER_MODE=docker ./start-relayer.sh start
```

Or directly with docker-compose:
```bash
# Copy SSL certificates to the ssl/ directory
mkdir -p ssl
cp /home/ec2-user/fs4/ssl1.cert ssl/
cp /home/ec2-user/fs4/ssl2.key ssl/
docker-compose up -d
```

This will start:
- Nginx on ports 80 and 443
- The relayer service (accessible internally on port 8080)
- Optional services (Redis, Prometheus, Grafana)

## Configuration Details

### Nginx Configuration (`nginx.conf`)

- **HTTPS Server (port 443)**: Redirects all traffic to HTTP
- **HTTP Server (port 80)**: Proxies requests to the relayer service

### Docker Compose Changes

- Added `nginx` service with Alpine Linux image
- Changed relayer to use `expose` instead of `ports` (only accessible within Docker network)
- Nginx handles all external traffic

## Testing

1. Test HTTP access:
   ```bash
   curl http://localhost/health
   ```

2. Test HTTPS redirect:
   ```bash
   curl -k https://localhost/health
   ```
   This should redirect to HTTP.

## Production Considerations

1. Replace self-signed certificates with valid SSL certificates
2. Consider using Let's Encrypt for free SSL certificates
3. Adjust nginx configuration for your domain name
4. Consider adding rate limiting and security headers
5. Monitor logs in the nginx container:
   ```bash
   docker logs continuum-nginx
   ```