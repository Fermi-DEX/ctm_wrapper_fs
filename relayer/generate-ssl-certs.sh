#!/bin/bash

# Create SSL directory if it doesn't exist
mkdir -p ssl

# Generate self-signed certificate for development
# Replace this with real certificates in production
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout ssl/key.pem \
    -out ssl/cert.pem \
    -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

echo "Self-signed SSL certificates generated in ./ssl/"
echo "NOTE: These are for development only. Use proper certificates in production."