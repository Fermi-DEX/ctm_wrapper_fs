#!/bin/bash

echo "Testing relayer with --devnet flag..."

# Test endpoints
echo -e "\n1. Testing /health endpoint:"
curl -s http://localhost:8080/health | jq .

echo -e "\n2. Testing /api/v1/info endpoint:"
curl -s http://localhost:8080/api/v1/info | jq .

echo -e "\n3. Testing /api/v1/pools endpoint:"
curl -s http://localhost:8080/api/v1/pools | jq .

echo -e "\n4. Testing pool price endpoint:"
POOL_ID=$(curl -s http://localhost:8080/api/v1/pools | jq -r '.pools[0].poolId')
echo "Pool ID: $POOL_ID"
curl -s http://localhost:8080/api/v1/pools/$POOL_ID/price | jq .

echo -e "\n5. Testing airdrop endpoint (SOL):"
TEST_WALLET="8YPqJxPNmYFcgmFQPResoLfwWcewTEBSfcv9MLs8HBTe"
curl -s -X POST http://localhost:8080/api/v1/airdrop \
  -H "Content-Type: application/json" \
  -d "{\"address\": \"$TEST_WALLET\", \"token\": \"SOL\", \"amount\": 0.1}" | jq .

echo -e "\n6. Testing airdrop endpoint (USDC):"
curl -s -X POST http://localhost:8080/api/v1/airdrop \
  -H "Content-Type: application/json" \
  -d "{\"address\": \"$TEST_WALLET\", \"token\": \"USDC\"}" | jq .

echo -e "\n7. Testing airdrop endpoint (WSOL):"
curl -s -X POST http://localhost:8080/api/v1/airdrop \
  -H "Content-Type: application/json" \
  -d "{\"address\": \"$TEST_WALLET\", \"token\": \"WSOL\"}" | jq .

echo -e "\nDone!"