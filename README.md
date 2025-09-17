# Continuum CP-Swap

MEV protection for Raydium CP-Swap through FIFO ordering and custom authority pools.

## Overview

The CTM Wrapper (Continuum) provides MEV protection for Raydium CP-Swap pools by:
- Setting itself as the custom authority for CP-Swap pools
- Processing swaps through a FIFO queue system
- Using relayer verification for order execution
- Preventing front-running and sandwich attacks

## Program IDs

### Devnet
- **CTM Wrapper Program**: `EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3`
- **Raydium CP-Swap Program**: `GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp`

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
