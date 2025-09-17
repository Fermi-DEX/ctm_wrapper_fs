# Continuum CP-Swap

MEV protection for Raydium CP-Swap through FIFO ordering and custom authority pools.

## Overview

The CTM Wrapper (Continuum) provides MEV protection for Raydium CP-Swap pools by:
- Setting itself as the custom authority for CP-Swap pools
- Processing swaps through a FIFO queue system
- Using relayer verification for order execution
- Preventing front-running and sandwich attacks

## Table of Contents
- [Installation](#installation)
- [SDK Usage](#sdk-usage)
- [Test Scripts](#test-scripts)
- [Development Setup](#development-setup)
- [Environment Variables](#environment-variables)
- [Pool Initialization](#pool-initialization-guide)
- [Order Execution](#order-execution)

## Program IDs

### Devnet
- **CTM Wrapper Program**: `EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3`
- **Raydium CP-Swap Program**: `GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp`

## Installation

```bash
# Clone the repository
git clone https://github.com/your-org/ctm-wrapper
cd ctm-wrapper

# Install dependencies
npm install

# Build the SDK
cd sdk && npm run build && cd ..

# Build the relayer (if running locally)
cd relayer && npm run build && cd ..
```

## SDK Usage

### TypeScript Development Setup

The SDK is written in TypeScript and provides full type safety for all operations.

```typescript
import { ContinuumClient } from '@continuum/sdk';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Initialize connection
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

// Load wallet (use environment variables in production)
const wallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.WALLET_PRIVATE_KEY!))
);

// Initialize client
const client = new ContinuumClient(
  connection,
  new PublicKey('EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3')
);
```

### Submitting Orders

```typescript
// Submit a swap order
const result = await client.submitOrder(wallet, {
  poolId: new PublicKey('YOUR_POOL_ID'),
  amountIn: new BN(1000000), // 1 USDC (6 decimals)
  minAmountOut: new BN(900000), // Minimum 0.9 USDC out (10% slippage)
  isBaseInput: true,
  userSourceToken: sourceTokenAccount,
  userDestinationToken: destTokenAccount
});

console.log('Order submitted:', result.signature);
console.log('Order sequence:', result.sequence.toString());
```

### Checking Order Status

```typescript
// Get order state
const orderState = await client.getOrderState(
  wallet.publicKey,
  result.sequence
);

if (orderState) {
  console.log('Order status:', orderState.status);
  // 0 = Pending, 1 = Executed, 2 = Cancelled, 3 = Failed
}
```

## Test Scripts

The repository includes comprehensive test scripts for various scenarios:

### Available Test Scripts

| Script | Description | Command |
|--------|-------------|---------|
| `test_complete_flow.ts` | Full end-to-end test including pool creation | `npx ts-node scripts/test_complete_flow.ts` |
| `test_ctm_direct_init.ts` | Direct pool initialization with CTM authority | `npx ts-node scripts/test_ctm_direct_init.ts` |
| `test_swap_with_direct_pool.ts` | Test swap on existing pool | `npx ts-node scripts/test_swap_with_direct_pool.ts` |
| `register_existing_pool.ts` | Register an existing pool | `npx ts-node scripts/register_existing_pool.ts` |
| `test_failed_orders.ts` | Test error handling scenarios | `npx ts-node scripts/test_failed_orders.ts` |

### Running Tests

```bash
# Run a specific test
npx ts-node scripts/test_complete_flow.ts

# Run with custom RPC
RPC_URL=https://your-rpc.com npx ts-node scripts/test_complete_flow.ts

# Run with debug output
DEBUG=* npx ts-node scripts/test_complete_flow.ts
```

## Development Setup

### Prerequisites

- Node.js v18 or higher
- TypeScript 4.9 or higher
- Solana CLI tools
- Anchor Framework (for smart contract development)

### Local Development

1. **Start local validator** (optional):
```bash
solana-test-validator --reset
```

2. **Deploy programs** (if testing locally):
```bash
# Deploy CTM Wrapper
anchor deploy --program-id EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3

# Initialize CTM Wrapper
npx ts-node scripts/initialize.ts
```

3. **Start relayer**:
```bash
cd relayer
npm start
```

### TypeScript Configuration

The project uses TypeScript with strict mode enabled. Key configuration:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src"
  }
}
```

## Environment Variables

### Required Variables

Create a `.env` file in the project root:

```bash
# Network Configuration
NETWORK=devnet
RPC_URL=https://api.devnet.solana.com
WS_URL=wss://api.devnet.solana.com

# Program IDs
CONTINUUM_PROGRAM_ID=EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3
CP_SWAP_PROGRAM_ID=GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp

# Wallet Configuration (for testing only - use secure key management in production)
WALLET_PATH=/home/user/.config/solana/id.json

# Relayer Configuration
RELAYER_KEYPAIR_PATH=./relayer-keypair.json
RELAYER_FEE_BPS=10
PORT=8082

# Performance Settings
POLL_INTERVAL_MS=1000
MAX_CONCURRENT_EXECUTIONS=5
RETRY_ATTEMPTS=3
```

### Security Notes

- **Never commit private keys or mnemonics to version control**
- Use environment variables or secure key management services
- In production, use hardware wallets or KMS solutions
- Rotate keys regularly and monitor for unauthorized access

## Pool Initialization Guide

### Creating a CP-Swap Pool with CTM Wrapper Authority

To create a new CP-Swap pool that uses the CTM Wrapper for MEV protection, follow these steps:

#### 1. Prerequisites

- Ensure the CTM Wrapper program is initialized (check for FIFO state)
- Have SOL for transaction fees and pool creation
- Create or have access to two SPL tokens for the pool

#### 2. Derive Pool Accounts

```typescript
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

// Derive CP-Swap PDAs
function getCpSwapPDAs(token0: PublicKey, token1: PublicKey, ammConfig: PublicKey) {
  // Ensure tokens are sorted
  const [sortedToken0, sortedToken1] = token0.toBuffer().compare(token1.toBuffer()) < 0
    ? [token0, token1]
    : [token1, token0];

  // Pool state PDA
  const [poolState] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('pool'),
      ammConfig.toBuffer(),
      sortedToken0.toBuffer(),
      sortedToken1.toBuffer(),
    ],
    CP_SWAP_PROGRAM_ID
  );

  // Derive other PDAs (authority, LP mint, vaults, etc.)
  // See full implementation in scripts/test_ctm_direct_init.ts

  return { poolState, sortedToken0, sortedToken1, /* ... */ };
}

// Derive CTM Wrapper pool authority
const [ctmPoolAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from('cp_pool_authority'), poolState.toBuffer()],
  CONTINUUM_PROGRAM_ID
);
```

#### 3. Initialize the Pool

```typescript
// Create pool fee account (required by CP-Swap)
const feeOwner = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq');
const createPoolFee = getAssociatedTokenAddressSync(sortedToken0, feeOwner);

// Build instruction data with custom authority
const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]); // CP-Swap initialize
const authorityType = Buffer.from([1]); // 1 = custom authority
const optionTag = Buffer.from([1]); // 1 = Some (authority provided)

const instructionData = Buffer.concat([
  discriminator,
  initAmount0.toArrayLike(Buffer, 'le', 8),
  initAmount1.toArrayLike(Buffer, 'le', 8),
  openTime.toArrayLike(Buffer, 'le', 8),
  authorityType,
  optionTag,
  ctmPoolAuthority.toBuffer(), // CTM Wrapper authority as custom authority
]);

// Create initialization instruction
const initPoolIx = new TransactionInstruction({
  keys: [
    { pubkey: creator, isSigner: true, isWritable: true },
    { pubkey: ammConfig, isSigner: false, isWritable: false },
    { pubkey: cpSwapAuthority, isSigner: false, isWritable: false }, // CP-Swap's own authority
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: sortedToken0, isSigner: false, isWritable: false },
    { pubkey: sortedToken1, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: creatorToken0, isSigner: false, isWritable: true },
    { pubkey: creatorToken1, isSigner: false, isWritable: true },
    { pubkey: creatorLpToken, isSigner: false, isWritable: true },
    { pubkey: vault0, isSigner: false, isWritable: true },
    { pubkey: vault1, isSigner: false, isWritable: true },
    { pubkey: createPoolFee, isSigner: false, isWritable: true },
    { pubkey: observationState, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_0_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_1_program
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ],
  programId: CP_SWAP_PROGRAM_ID,
  data: instructionData,
});
```

#### 4. Important Notes

- **Authority Type**: Must be set to `1` for custom authority
- **Custom Authority**: Use the CTM Wrapper's pool authority PDA (`cp_pool_authority`)
- **Fee Account**: Must be initialized before pool creation
- **Token Sorting**: Tokens must be sorted by their public key bytes
- **AMM Config**: Must exist on-chain (index 0 is commonly used on devnet)

### Complete Example

A complete working example is available in `scripts/test_ctm_direct_init.ts`. To run it:

```bash
npx ts-node scripts/test_ctm_direct_init.ts
```

This script will:
1. Create test tokens
2. Set up token accounts and mint initial supply
3. Create the fee account
4. Initialize the CP-Swap pool with CTM Wrapper authority
5. Verify the pool was created successfully

## Order Execution

### Order Lifecycle

1. **Submission**: User submits order to CTM Wrapper
2. **Queuing**: Order is added to FIFO queue with sequence number
3. **Validation**: Relayer validates order parameters
4. **Execution**: Relayer executes swap on CP-Swap pool
5. **Settlement**: Tokens are transferred to user

### Error Handling

The system handles various failure scenarios gracefully:

#### Insufficient Funds
When a user doesn't have enough tokens:
```typescript
try {
  await client.submitOrder(wallet, orderParams);
} catch (error) {
  if (error.message.includes('insufficient funds')) {
    console.error('Not enough tokens for swap');
  }
}
```

#### Slippage Protection
Orders fail if price moves beyond tolerance:
```typescript
const orderParams = {
  amountIn: new BN(1000000),
  minAmountOut: new BN(990000), // 1% slippage tolerance
  // Order fails if output would be < 990000
};
```

#### Order Cancellation
Users can cancel pending orders:
```typescript
await client.cancelOrder(wallet, orderSequence);
```

### Monitoring and Debugging

#### Check Order Status
```typescript
const status = await client.getOrderState(userPubkey, sequence);
console.log('Status:', status.status);
// 0 = Pending, 1 = Executed, 2 = Cancelled, 3 = Failed
```

#### Monitor Relayer Logs
```bash
# View relayer logs
tail -f relayer/relayer.log

# Filter for specific order
grep "sequence:123" relayer/relayer.log
```

#### Debug Failed Transactions
```typescript
try {
  const result = await client.submitOrder(wallet, params);
} catch (error) {
  console.error('Transaction logs:', error.logs);
  // Analyze logs for specific error
}
```
