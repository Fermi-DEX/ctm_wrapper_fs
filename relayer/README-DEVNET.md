# Running Relayer on Devnet

## Prerequisites

1. Ensure you have a funded devnet wallet for the relayer:
   ```bash
   solana airdrop 2 --url devnet
   ```

2. The relayer wallet also needs devnet USDC and WSOL tokens for airdrops. Use the devnet scripts to mint these tokens to your relayer wallet.

## Starting the Relayer

Run the relayer with the `--devnet` flag:

```bash
npm run dev -- --devnet
```

Or set the environment variable:

```bash
NETWORK=devnet npm run dev
```

## Configuration

When running with `--devnet`, the relayer automatically:

- Uses devnet RPC endpoint (https://api.devnet.solana.com)
- Loads program IDs from constants.json devnet configuration
- Enables token airdrops for USDC and WSOL
- Disables mock mode for real blockchain execution
- Uses the devnet pool configuration

## API Endpoints

### Health Check
```bash
curl http://localhost:8080/health
```

### Get Pool Info
```bash
curl http://localhost:8080/api/v1/pools
```

### Get Pool Price
```bash
curl http://localhost:8080/api/v1/pools/{poolId}/price
```

### Request Airdrop

For SOL:
```bash
curl -X POST http://localhost:8080/api/v1/airdrop \
  -H "Content-Type: application/json" \
  -d '{"address": "YOUR_WALLET", "token": "SOL", "amount": 0.1}'
```

For USDC (1000 tokens):
```bash
curl -X POST http://localhost:8080/api/v1/airdrop \
  -H "Content-Type: application/json" \
  -d '{"address": "YOUR_WALLET", "token": "USDC"}'
```

For WSOL (10 tokens):
```bash
curl -X POST http://localhost:8080/api/v1/airdrop \
  -H "Content-Type: application/json" \
  -d '{"address": "YOUR_WALLET", "token": "WSOL"}'
```

### Submit Order

```bash
curl -X POST http://localhost:8080/api/v1/orders \
  -H "Content-Type: application/json" \
  -d '{
    "transaction": "BASE64_ENCODED_TRANSACTION",
    "poolId": "9AJUf9ZQ2sWq93ose12BePBn4sq36cyqE98MiZraFLJT",
    "amountIn": "100000000",
    "minAmountOut": "90000000",
    "isBaseInput": true,
    "userPublicKey": "USER_WALLET_ADDRESS"
  }'
```

## Testing

Run the test script to verify all endpoints:

```bash
./test-devnet.sh
```

## Important Notes

1. **Real Transactions**: On devnet, the relayer executes real blockchain transactions. Ensure your relayer wallet has sufficient SOL for transaction fees.

2. **Token Balances**: For token airdrops to work, the relayer wallet must hold USDC and WSOL tokens. Use the devnet scripts to mint these to your relayer wallet first.

3. **Rate Limiting**: Airdrops are rate-limited to once per minute per IP address.

4. **Pool Configuration**: The devnet pool (USDC-WSOL) is loaded from constants.json with all necessary addresses.

## Troubleshooting

### "Insufficient balance in relayer wallet"
Fund your relayer wallet with the required tokens using the devnet scripts:
```bash
cd ../scripts/devnet
./create-tokens-devnet.ts
# Then transfer tokens to your relayer wallet
```

### "Token airdrops only available on devnet"
Ensure you're running with the `--devnet` flag or `NETWORK=devnet` environment variable.

### Connection Issues
Check that devnet RPC is accessible and not rate-limited. You can use a custom RPC endpoint:
```bash
RPC_URL=https://your-devnet-rpc.com npm run dev -- --devnet
```